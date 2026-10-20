import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createRemoteJwksProductTokenVerifier,
  type EffectiveEntitlements,
  type ProductIdentityStatus,
  type ProductProvisioningStatus,
  type ProductTokenClaims,
} from '@mariya-abdul/deltcrm-product-contracts';
import { ProductIntegrationClient } from '@mariya-abdul/deltcrm-product-contracts/generated';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { hashPassword } from '../security/password.js';
import type { PermissionGrant, UserContext } from './auth.types.js';

/**
 * The POS API keeps its existing local permission vocabulary. Product Contract
 * permissions are translated here once, at the auth boundary, so controllers
 * and services do not need a second authorization system.
 */
const PRODUCT_TO_POS_PERMISSION: Readonly<Record<string, readonly string[]>> = {
  'pos.organization.read': ['org.overview.view', 'store.overview.view'],
  'pos.organization.manage': ['org.settings.manage'],
  'pos.users.read': ['users.view', 'store.staff.view'],
  'pos.users.manage': ['users.manage', 'store.staff.manage'],
  'pos.stores.read': ['stores.view', 'store.overview.view'],
  'pos.stores.manage': ['stores.manage', 'store.settings.manage'],
  'pos.catalog.read': ['catalog.view'],
  'pos.catalog.manage': ['catalog.manage', 'catalog.manage.store'],
  'pos.pricing.read': ['pricing.view'],
  'pos.pricing.manage': ['pricing.manage'],
  'pos.tax.read': ['tax.view'],
  'pos.tax.manage': ['tax.manage'],
  'pos.registers.read': ['registers.view'],
  'pos.registers.manage': ['registers.manage', 'register.open', 'register.close', 'cash.manage'],
  'pos.sales.read': ['sale.view'],
  'pos.sales.create': ['sale.create', 'sale.hold', 'sale.discount'],
  'pos.sales.manage': ['sale.void'],
  'pos.inventory.read': ['inventory.view'],
  'pos.inventory.manage': ['inventory.manage'],
  'pos.customers.read': ['customer.view'],
  'pos.customers.manage': ['customer.manage'],
  'pos.reports.read': ['report.view'],
  'pos.reports.export': ['report.export'],
  'pos.refunds.read': ['refund.view'],
  'pos.refunds.manage': ['refund.create'],
  'pos.refunds.create': ['refund.create'],
  'pos.approvals.request': ['approval.request'],
  'pos.approvals.manage': ['approval.manage'],
  'pos.attendance.read': ['attendance.view'],
  'pos.attendance.manage': ['attendance.manage'],
  'pos.settings.manage': ['store.settings.manage'],
  'pos.audit.read': ['audit.view'],
  'pos.transfers.manage': ['transfer.manage'],
};

/** Mapped permission that marks a CRM membership as the organisation-wide administrator,
 * equivalent to POS's local "Organisation Administrator" system role. */
const ORGANISATION_ADMIN_POS_PERMISSION = 'org.settings.manage';

export function platformClaimsToPosGrants(claims: ProductTokenClaims): PermissionGrant[] {
  const roleName = claims.roles.length > 0 ? claims.roles.join(', ') : 'CRM Product Member';
  return [...new Set(claims.permissions)]
    .flatMap((permission) => PRODUCT_TO_POS_PERMISSION[permission] ?? [])
    .filter((permission, index, permissions) => permissions.indexOf(permission) === index)
    .map((permissionCode) => ({
      permissionCode,
      effect: 'ALLOW' as const,
      roleName,
      scopeType: 'ORGANIZATION' as const,
      scopeId: null,
    }));
}

export function isOrganisationAdministratorGrant(grants: PermissionGrant[]): boolean {
  return grants.some((grant) => grant.permissionCode === ORGANISATION_ADMIN_POS_PERMISSION);
}

export function assertPosProductClaims(claims: ProductTokenClaims, requestedTenant?: string): void {
  if (
    claims.sub !== claims.userId ||
    !claims.tenantId ||
    !claims.membershipId ||
    !claims.products.includes('POS')
  ) {
    throw new UnauthorizedException({ code: 'INVALID_PRODUCT_TOKEN_CLAIMS', message: 'A valid POS product token is required' });
  }
  if (requestedTenant && requestedTenant !== claims.tenantId) {
    throw new UnauthorizedException({ code: 'PRODUCT_TOKEN_TENANT_MISMATCH', message: 'The requested tenant does not match the product token' });
  }
}

/** Tiny in-memory TTL cache for the three Platform contract calls made on every request.
 * Scoped to a single API process: each replica keeps its own cache, which is fine because
 * entries are short-lived (seconds) and every change CRM makes still carries a fresh
 * entitlementVersion that the token-staleness check below will catch. */
class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

const CONTRACT_CACHE_TTL_MS = 30_000;

@Injectable()
export class PlatformAuthService {
  private verifier?: (token: string) => Promise<ProductTokenClaims>;
  private readonly platformBaseUrl = (process.env.PLATFORM_INTERNAL_BASE_URL ?? 'http://127.0.0.1:4011').replace(/\/$/, '');
  private readonly platform = new ProductIntegrationClient({
    baseUrl: this.platformBaseUrl,
    serviceProductKey: 'POS',
    serviceKey: this.resolveServiceKey(),
  });
  private readonly identityCache = new TtlCache<ProductIdentityStatus>(CONTRACT_CACHE_TTL_MS);
  private readonly entitlementsCache = new TtlCache<EffectiveEntitlements>(CONTRACT_CACHE_TTL_MS);
  private readonly provisioningCache = new TtlCache<ProductProvisioningStatus>(CONTRACT_CACHE_TTL_MS);

  constructor(private readonly prisma: PrismaService) {}

  async authenticateToken(rawToken: string, requestedTenant?: string): Promise<UserContext> {
    let claims: ProductTokenClaims;
    try {
      claims = await this.tokenVerifierForEnvironment()(rawToken);
      assertPosProductClaims(claims, requestedTenant);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException({ code: 'INVALID_PRODUCT_TOKEN', message: 'A valid POS product token is required' });
    }

    let identity: ProductIdentityStatus;
    let entitlements: EffectiveEntitlements;
    let provisioning: ProductProvisioningStatus;
    try {
      [identity, entitlements, provisioning] = await Promise.all([
        this.cached(this.identityCache, `identity:${claims.tenantId}:${claims.userId}:${claims.membershipId}`, () =>
          this.platform.identityStatus(claims.tenantId, claims.userId, claims.membershipId),
        ),
        this.cached(this.entitlementsCache, `entitlements:${claims.tenantId}`, () =>
          this.platform.productEntitlements(claims.tenantId, 'POS'),
        ),
        this.cached(this.provisioningCache, `provisioning:${claims.tenantId}`, () =>
          this.platform.provisioningStatus(claims.tenantId, 'POS'),
        ),
      ]);
    } catch {
      throw new ServiceUnavailableException({ code: 'PLATFORM_CONTRACT_UNAVAILABLE', message: 'The CRM Product Contract service is temporarily unavailable' });
    }
    if (identity.tenantStatus !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'TENANT_ACCESS_SUSPENDED', message: 'This workspace is not active' });
    }
    if (identity.userStatus !== 'ACTIVE' || identity.membershipStatus !== 'ACTIVE') {
      throw new UnauthorizedException({ code: 'PRODUCT_IDENTITY_INACTIVE', message: 'This CRM membership is not active' });
    }
    const entitlement = entitlements.products.find(({ key }) => key === 'POS');
    if (entitlements.subscriptionStatus === 'SUSPENDED' || !entitlement?.active) {
      throw new ForbiddenException({ code: 'PRODUCT_NOT_ENTITLED', message: 'POS is not enabled for this CRM workspace' });
    }
    if (provisioning.state !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'PRODUCT_NOT_PROVISIONED', message: `POS is ${provisioning.state.toLowerCase()} for this workspace` });
    }
    if (claims.entitlementVersion !== entitlements.version) {
      throw new UnauthorizedException({ code: 'STALE_PRODUCT_TOKEN', message: 'The POS product token is stale; request a new one' });
    }

    const grants = platformClaimsToPosGrants(claims);
    const isOrganisationAdministrator = isOrganisationAdministratorGrant(grants);
    const projection = await this.ensureProjection(claims, isOrganisationAdministrator);
    return {
      userId: projection.userId,
      organizationId: projection.organizationId,
      email: projection.email,
      displayName: projection.displayName,
      preferredLocale: claims.locale,
      status: 'ACTIVE',
      defaultStoreId: projection.defaultStoreId,
      storeIds: projection.storeIds,
      grants,
      isOrganisationAdministrator,
      authSource: 'CRM_PRODUCT_TOKEN',
      platformTenantId: claims.tenantId,
      platformMembershipId: claims.membershipId,
      platformCapabilities: claims.capabilities,
    };
  }

  private async cached<T>(cache: TtlCache<T>, key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    cache.set(key, value);
    return value;
  }

  private resolveServiceKey(): string | undefined {
    const configured = process.env.POS_PLATFORM_SERVICE_KEY ?? process.env.PRODUCT_SERVICE_API_KEY;
    if (configured) return configured;
    // Only ever fall back to the known local-dev key outside development/test. A staging or
    // preview environment that forgets to set NODE_ENV=production must still fail closed here,
    // not silently borrow the key every local developer already knows.
    const env = process.env.NODE_ENV ?? 'development';
    return env === 'development' || env === 'test' ? 'local-pos-product-service-key' : undefined;
  }

  private tokenVerifierForEnvironment() {
    if (this.verifier) return this.verifier;
    const issuer = process.env.PRODUCT_TOKEN_ISSUER ?? 'https://auth.local.blufield.test';
    const jwksUrl = process.env.PLATFORM_JWKS_URL ?? `${this.platformBaseUrl}/.well-known/jwks.json`;
    this.verifier = createRemoteJwksProductTokenVerifier({ issuer, audience: process.env.POS_PLATFORM_AUDIENCE ?? 'pos-api', productKey: 'POS', jwksUrl });
    return this.verifier;
  }

  /** Looks up the CRM member's email for a brand-new POS user. CRM's tenant directory is a
   * paginated, email-search endpoint rather than a lookup-by-id, so this scans one bounded
   * page (100 members) rather than the whole tenant. If the member isn't found there (a very
   * large tenant, or directory visibility rules), POS falls back to a synthetic placeholder
   * exactly as before; the account still links correctly by platformUserId either way. */
  private async lookupMemberEmail(tenantId: string, userId: string): Promise<string | undefined> {
    try {
      const page = await this.platform.tenantMembers(tenantId, { limit: 100, status: 'ACTIVE' });
      return page.data.find((member) => member.userId === userId)?.email;
    } catch {
      return undefined;
    }
  }

  private async ensureProjection(
    claims: ProductTokenClaims,
    isOrganisationAdministrator: boolean,
  ): Promise<{ organizationId: string; userId: string; email: string; displayName: string; defaultStoreId: string | null; storeIds: string[] }> {
    const organization = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: { platformTenantId: claims.tenantId },
        update: { status: 'ACTIVE' },
        create: {
          name: `CRM workspace ${claims.tenantId.slice(0, 8)}`,
          slug: `crm-${claims.tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)}`,
          platformTenantId: claims.tenantId,
          taxProfileStatus: 'LEGACY',
        },
      });
      await tx.organizationEntitlement.upsert({
        where: { organizationId: organization.id },
        update: {},
        create: { organizationId: organization.id, maxStores: 5 },
      });
      await tx.organizationSettings.upsert({
        where: { organizationId: organization.id },
        update: {},
        create: { organizationId: organization.id, settings: { enabledTenders: ['CASH'] } },
      });
      return organization;
    });

    // Resolve (and possibly create) the user outside the organization transaction: the member
    // lookup is a network call to Platform and must not hold a DB transaction open across it.
    const existingByPlatformId = await this.prisma.user.findUnique({
      where: { organizationId_platformUserId: { organizationId: organization.id, platformUserId: claims.userId } },
    });

    let user = existingByPlatformId;
    if (!user) {
      const memberEmail = await this.lookupMemberEmail(claims.tenantId, claims.userId);
      const email = (memberEmail ?? `crm-${claims.userId}@platform.invalid`).toLowerCase();

      // An org admin or manually-created POS account may already exist for this email
      // (e.g. it was created before this organisation was linked to CRM). Link to it
      // instead of creating a duplicate user the next time this person signs in.
      const existingByEmail = await this.prisma.user.findFirst({
        where: { organizationId: organization.id, email, platformUserId: null },
      });

      if (existingByEmail) {
        user = await this.prisma.user.update({
          where: { id: existingByEmail.id },
          data: { status: 'ACTIVE', platformUserId: claims.userId, platformMembershipId: claims.membershipId },
        });
      } else {
        const namePart = memberEmail?.split('@')[0] ?? `crm-${claims.userId.slice(0, 8)}`;
        user = await this.prisma.user.create({
          data: {
            organizationId: organization.id,
            platformUserId: claims.userId,
            platformMembershipId: claims.membershipId,
            email,
            passwordHash: hashPassword(randomBytes(32).toString('base64url')),
            firstName: namePart,
            lastName: '',
          },
        });
      }
    } else if (user.status !== 'ACTIVE' || user.platformMembershipId !== claims.membershipId) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', platformMembershipId: claims.membershipId },
      });
    }

    let storeIds: string[];
    let defaultStoreId: string | null;
    if (isOrganisationAdministrator) {
      const stores = await this.prisma.store.findMany({
        where: { organizationId: organization.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      storeIds = stores.map((store) => store.id);
      defaultStoreId = user.defaultStoreId ?? stores[0]?.id ?? null;
      if (defaultStoreId && defaultStoreId !== user.defaultStoreId) {
        await this.prisma.user.update({ where: { id: user.id }, data: { defaultStoreId } });
      }
    } else {
      // Non-admin CRM members follow the same model as any other POS employee: an organisation
      // admin must assign them to specific stores from the POS staff screen before they can
      // use store-scoped features. Until that happens, storeIds stays empty, same as a brand
      // new manually-created user would see today.
      const assigned = await this.prisma.userStore.findMany({ where: { userId: user.id }, select: { storeId: true } });
      storeIds = assigned.map((row) => row.storeId);
      defaultStoreId = user.defaultStoreId;
    }

    return {
      organizationId: organization.id,
      userId: user.id,
      email: user.email,
      displayName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      defaultStoreId,
      storeIds,
    };
  }
}

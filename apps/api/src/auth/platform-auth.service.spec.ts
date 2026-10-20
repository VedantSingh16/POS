import { describe, expect, it } from 'vitest';
import type { ProductTokenClaims } from '@mariya-abdul/deltcrm-product-contracts';
import {
  assertPosProductClaims,
  isOrganisationAdministratorGrant,
  platformClaimsToPosGrants,
  PlatformAuthService,
} from './platform-auth.service.js';
import type { PrismaService } from '../database/prisma.service.js';

const claims = (overrides: Partial<ProductTokenClaims> = {}): ProductTokenClaims => ({
  sub: 'user-1', tenantId: 'tenant-1', userId: 'user-1', membershipId: 'membership-1',
  roles: ['BUSINESS_ADMIN'], products: ['POS'], capabilities: ['POS_CORE'],
  permissions: ['pos.organization.read', 'pos.sales.create', 'pos.inventory.manage'], locale: 'en',
  entitlementVersion: 4, iss: 'https://auth.local.blufield.test', aud: 'pos-api', iat: 1, exp: 9_999_999_999, jti: 'jti-1',
  ...overrides,
});

describe('POS Product Contract auth', () => {
  it('translates product permissions into the existing POS authorization vocabulary', () => {
    expect(platformClaimsToPosGrants(claims()).map((grant) => grant.permissionCode)).toEqual(['org.overview.view', 'store.overview.view', 'sale.create', 'sale.hold', 'sale.discount', 'inventory.manage']);
  });

  it('rejects a token for another tenant', () => {
    expect(() => assertPosProductClaims(claims(), 'tenant-2')).toThrowError(/requested tenant/i);
  });

  it('rejects a token that does not contain POS membership', () => {
    expect(() => assertPosProductClaims(claims({ products: ['HRMS'] }))).toThrowError(/valid POS product token/i);
  });

  it('rejects a token whose sub does not match userId', () => {
    expect(() => assertPosProductClaims(claims({ sub: 'someone-else' }))).toThrowError(/valid POS product token/i);
  });

  it('rejects a token with no tenantId or membershipId', () => {
    expect(() => assertPosProductClaims(claims({ tenantId: '' }))).toThrowError(/valid POS product token/i);
    expect(() => assertPosProductClaims(claims({ membershipId: '' }))).toThrowError(/valid POS product token/i);
  });

  it('accepts a token for the tenant it was requested for', () => {
    expect(() => assertPosProductClaims(claims(), 'tenant-1')).not.toThrow();
  });

  it('marks a member with pos.organization.manage as organisation administrator', () => {
    expect(isOrganisationAdministratorGrant(platformClaimsToPosGrants(claims({ permissions: ['pos.organization.manage'] })))).toBe(true);
  });

  it('does not mark an ordinary member as organisation administrator', () => {
    expect(isOrganisationAdministratorGrant(platformClaimsToPosGrants(claims({ permissions: ['pos.sales.create'] })))).toBe(false);
  });

  it('deduplicates grants produced by repeated product permissions', () => {
    const codes = platformClaimsToPosGrants(claims({ permissions: ['pos.sales.create', 'pos.sales.create', 'pos.sales.manage'] })).map((g) => g.permissionCode);
    expect(codes.length).toBe(new Set(codes).size);
  });

  it('reflects every CRM role in the grant label, not just the first', () => {
    const grants = platformClaimsToPosGrants(claims({ roles: ['BUSINESS_ADMIN', 'STORE_MANAGER'] }));
    expect(grants.every((g) => g.roleName === 'BUSINESS_ADMIN, STORE_MANAGER')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// authenticateToken: a minimal fake Prisma + a stubbed Product Contract client,
// exercising the full method the way a real request would, without a database
// or network. Covers the gaps fixed in this change: store/admin projection,
// email-based linking for pre-existing accounts, and the short-lived cache.
// ---------------------------------------------------------------------------

function entitlementsFor(overrides: { version?: number; active?: boolean; subscriptionStatus?: string } = {}) {
  return {
    tenantId: 'tenant-1',
    subscriptionStatus: overrides.subscriptionStatus ?? 'ACTIVE',
    version: overrides.version ?? 4,
    effectiveAt: new Date().toISOString(),
    products: [{ key: 'POS', active: overrides.active ?? true }],
  };
}
function identityFor(overrides: { tenantStatus?: string; userStatus?: string; membershipStatus?: string } = {}) {
  return {
    tenantId: 'tenant-1', userId: 'user-1', membershipId: 'membership-1',
    tenantStatus: overrides.tenantStatus ?? 'ACTIVE',
    userStatus: overrides.userStatus ?? 'ACTIVE',
    membershipStatus: overrides.membershipStatus ?? 'ACTIVE',
    effectiveAt: new Date().toISOString(),
  };
}
function provisioningFor(state = 'ACTIVE') {
  return { tenantId: 'tenant-1', productKey: 'POS', state, attempt: 1, updatedAt: new Date().toISOString() };
}

type FakeUser = { id: string; organizationId: string; platformUserId: string | null; platformMembershipId: string | null; email: string; firstName: string; lastName: string; status: string; defaultStoreId: string | null };
type FakeOrg = { id: string; platformTenantId: string; name: string; slug: string; taxProfileStatus: string; status?: string };

/** A tiny in-memory stand-in for PrismaService, covering only the calls platform-auth.service.ts makes. */
function createFakePrisma() {
  let seq = 0;
  const id = (prefix: string) => `${prefix}-${++seq}`;
  const organizations: FakeOrg[] = [];
  const users: FakeUser[] = [];
  const stores: { id: string; organizationId: string; status: string; createdAt: number }[] = [];
  const userStores: { userId: string; storeId: string }[] = [];

  const prisma = {
    organization: {
      upsert: async ({ where, update, create }: any) => {
        let org = organizations.find((o) => o.platformTenantId === where.platformTenantId);
        if (org) { Object.assign(org, update); return org; }
        org = { id: id('org'), ...create };
        organizations.push(org);
        return org;
      },
    },
    organizationEntitlement: { upsert: async () => ({}) },
    organizationSettings: { upsert: async () => ({}) },
    user: {
      findUnique: async ({ where }: any) => {
        const key = where.organizationId_platformUserId;
        return users.find((u) => u.organizationId === key.organizationId && u.platformUserId === key.platformUserId) ?? null;
      },
      findFirst: async ({ where }: any) =>
        users.find((u) => u.organizationId === where.organizationId && u.email === where.email && !u.platformUserId) ?? null,
      update: async ({ where, data }: any) => {
        const user = users.find((u) => u.id === where.id)!;
        Object.assign(user, data);
        return user;
      },
      create: async ({ data }: any) => {
        const user: FakeUser = { id: id('user'), defaultStoreId: null, status: 'ACTIVE', ...data };
        users.push(user);
        return user;
      },
    },
    store: {
      findMany: async ({ where, orderBy }: any) => {
        let result = stores.filter((s) => s.organizationId === where.organizationId && (!where.status || s.status === where.status));
        if (orderBy?.createdAt === 'asc') result = [...result].sort((a, b) => a.createdAt - b.createdAt);
        return result.map((s) => ({ id: s.id }));
      },
    },
    userStore: {
      findMany: async ({ where }: any) => userStores.filter((us) => us.userId === where.userId).map((us) => ({ storeId: us.storeId })),
    },
    $transaction: async (fn: any) => fn(prisma),
    _organizations: organizations,
    _users: users,
    _seedStore(organizationId: string, createdAt: number) {
      const store = { id: id('store'), organizationId, status: 'ACTIVE', createdAt };
      stores.push(store);
      return store;
    },
    _seedUser(user: Partial<FakeUser> & { organizationId: string; email: string }) {
      const full: FakeUser = { id: id('user'), platformUserId: null, platformMembershipId: null, firstName: '', lastName: '', status: 'ACTIVE', defaultStoreId: null, ...user };
      users.push(full);
      return full;
    },
  };
  return prisma;
}

function makeService(overrides: { identity?: unknown; entitlements?: unknown; provisioning?: unknown; tenantMembers?: unknown } = {}) {
  const prisma = createFakePrisma();
  const service = new PlatformAuthService(prisma as unknown as PrismaService);
  const counts = { identity: 0, entitlements: 0, provisioning: 0 };
  const platform = (service as unknown as { platform: Record<string, unknown> }).platform;
  platform.identityStatus = async () => { counts.identity++; return overrides.identity ?? identityFor(); };
  platform.productEntitlements = async () => { counts.entitlements++; return overrides.entitlements ?? entitlementsFor(); };
  platform.provisioningStatus = async () => { counts.provisioning++; return overrides.provisioning ?? provisioningFor(); };
  platform.tenantMembers = async () => overrides.tenantMembers ?? { data: [], nextCursor: null };
  (service as unknown as { verifier: (token: string) => Promise<ProductTokenClaims> }).verifier = async () => claims({ permissions: ['pos.organization.manage', 'pos.sales.create'] });
  return { service, prisma, counts };
}

describe('PlatformAuthService.authenticateToken', () => {
  it('creates the organization and user on first sign-in, as an organisation administrator with no stores yet', async () => {
    const { service, prisma } = makeService();
    const ctx = await service.authenticateToken('token');
    expect(ctx.isOrganisationAdministrator).toBe(true);
    expect(ctx.authSource).toBe('CRM_PRODUCT_TOKEN');
    expect(ctx.storeIds).toEqual([]);
    expect(ctx.defaultStoreId).toBeNull();
    expect(prisma._organizations).toHaveLength(1);
  });

  it('assigns an organisation administrator every active store, defaulting to the earliest one', async () => {
    const { service, prisma } = makeService();
    await service.authenticateToken('token');
    const org = prisma._organizations[0];
    const older = prisma._seedStore(org.id, 100);
    const newer = prisma._seedStore(org.id, 200);
    const ctx = await service.authenticateToken('token');
    expect(new Set(ctx.storeIds)).toEqual(new Set([older.id, newer.id]));
    expect(ctx.defaultStoreId).toBe(older.id);
  });

  it('leaves a non-admin CRM member with only their locally-assigned stores', async () => {
    const { service } = makeService();
    await service.authenticateToken('token');
    (service as unknown as { verifier: (t: string) => Promise<ProductTokenClaims> }).verifier = async () =>
      claims({ userId: 'user-2', sub: 'user-2', membershipId: 'membership-2', permissions: ['pos.sales.create'] });
    const ctx = await service.authenticateToken('token-2');
    expect(ctx.isOrganisationAdministrator).toBe(false);
    expect(ctx.storeIds).toEqual([]);
  });

  it('links a brand-new CRM sign-in to a pre-existing POS account with the same email, instead of duplicating it', async () => {
    const { service, prisma } = makeService({ tenantMembers: { data: [{ userId: 'user-1', membershipId: 'm', email: 'alex@example.com', status: 'ACTIVE' }], nextCursor: null } });
    const org = await prisma.organization.upsert({ where: { platformTenantId: 'tenant-1' }, update: {}, create: { name: 'Pre-existing Org', slug: 'pre-existing', platformTenantId: 'tenant-1', taxProfileStatus: 'LEGACY' } });
    const manualUser = prisma._seedUser({ organizationId: org.id, email: 'alex@example.com', firstName: 'Alex', lastName: 'Original' });

    const ctx = await service.authenticateToken('token');
    expect(ctx.userId).toBe(manualUser.id);
    expect(prisma._users).toHaveLength(1);
  });

  it('caches the three Platform contract calls across repeated requests', async () => {
    const { service, counts } = makeService();
    await service.authenticateToken('token');
    await service.authenticateToken('token');
    await service.authenticateToken('token');
    expect(counts).toEqual({ identity: 1, entitlements: 1, provisioning: 1 });
  });

  it('rejects a suspended tenant', async () => {
    const { service } = makeService({ identity: identityFor({ tenantStatus: 'SUSPENDED' }) });
    await expect(service.authenticateToken('token')).rejects.toMatchObject({ body: { code: 'TENANT_ACCESS_SUSPENDED' } });
  });

  it('rejects when POS is not entitled for the tenant', async () => {
    const { service } = makeService({ entitlements: entitlementsFor({ active: false }) });
    await expect(service.authenticateToken('token')).rejects.toMatchObject({ body: { code: 'PRODUCT_NOT_ENTITLED' } });
  });

  it('rejects when the subscription itself is suspended', async () => {
    const { service } = makeService({ entitlements: entitlementsFor({ subscriptionStatus: 'SUSPENDED' }) });
    await expect(service.authenticateToken('token')).rejects.toMatchObject({ body: { code: 'PRODUCT_NOT_ENTITLED' } });
  });

  it('rejects when POS provisioning for the tenant is not yet active', async () => {
    const { service } = makeService({ provisioning: provisioningFor('PROVISIONING') });
    await expect(service.authenticateToken('token')).rejects.toMatchObject({ body: { code: 'PRODUCT_NOT_PROVISIONED' } });
  });

  it('rejects a stale product token once CRM entitlements have moved on', async () => {
    const { service } = makeService({ entitlements: entitlementsFor({ version: 999 }) });
    await expect(service.authenticateToken('token')).rejects.toMatchObject({ body: { code: 'STALE_PRODUCT_TOKEN' } });
  });

  it('fails fast on a tenant mismatch without calling Platform at all', async () => {
    const { service, counts } = makeService();
    await expect(service.authenticateToken('token', 'some-other-tenant')).rejects.toThrow();
    expect(counts.identity).toBe(0);
  });

  it('reports a clear, typed error when Platform is unreachable', async () => {
    const { service } = makeService();
    (service as unknown as { platform: Record<string, unknown> }).platform.identityStatus = async () => { throw new Error('ECONNREFUSED'); };
    await expect(service.authenticateToken('token')).rejects.toMatchObject({ body: { code: 'PLATFORM_CONTRACT_UNAVAILABLE' } });
  });
});

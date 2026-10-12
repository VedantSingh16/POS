import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { ORGANISATION_ADMINISTRATOR_ROLE } from './permission-catalogue.js';
import { PermissionGrant, UserContext } from './auth.types.js';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserContext(userId: string): Promise<UserContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        stores: { select: { storeId: true } },
        roles: {
          where: { role: { status: 'ACTIVE' } },
          include: { role: { select: { name: true, permissions: { select: { permissionCode: true, effect: true } } } } },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException('User is not active');

    const grants: PermissionGrant[] = user.roles.flatMap((assignment) =>
      assignment.role.permissions.map((permission) => ({
          permissionCode: permission.permissionCode,
          effect: permission.effect,
        roleName: assignment.role.name,
        scopeType: assignment.scopeType,
        scopeId: assignment.storeId,
      })),
    );

    return {
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      displayName: `${user.firstName} ${user.lastName}`.trim(),
      status: user.status,
      defaultStoreId: user.defaultStoreId,
      storeIds: user.stores.map((store) => store.storeId),
      grants,
      isOrganisationAdministrator: user.roles.some((assignment) =>
        assignment.role.name === ORGANISATION_ADMINISTRATOR_ROLE && assignment.scopeType === 'ORGANIZATION',
      ),
    };
  }

  /** Everything the web app needs to render and route: identity, organisation, roles, effective permissions per scope, reachable stores. */
  async getSessionProfile(context: UserContext) {
    const organisation = await this.prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { id: true, name: true, slug: true } });
    const pinOwner = await this.prisma.user.findUnique({ where: { id: context.userId }, select: { pinHash: true } });
    const settings = await this.prisma.organizationSettings.findUnique({ where: { organizationId: context.organizationId }, select: { settings: true } });
    const onboarding = (settings?.settings as { onboarding?: { required?: unknown; complete?: unknown } } | null)?.onboarding;
    const organizationCodes = [...new Set(context.grants.filter((grant) => grant.scopeType === 'ORGANIZATION').map((grant) => grant.permissionCode))];
    const hasOrganizationScope = context.isOrganisationAdministrator || organizationCodes.some((code) => this.hasPermission(context, code));
    const reachable = hasOrganizationScope
      ? undefined
      : [...new Set([...context.storeIds, ...context.grants.filter((g) => g.scopeType === 'STORE' && g.scopeId).map((g) => g.scopeId as string)])];
    const stores = await this.prisma.store.findMany({
      where: { organizationId: context.organizationId, status: 'ACTIVE', ...(reachable ? { id: { in: reachable } } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    const permissionCodes = [...new Set(context.grants.map((grant) => grant.permissionCode))];
    const organizationPermissions = organizationCodes.filter((code) => this.hasPermission(context, code)).sort();
    const storePermissions = Object.fromEntries(stores.map((store) => [
      store.id,
      permissionCodes.filter((code) => this.hasPermission(context, code, store.id)).sort(),
    ]));
    const roles = [...new Map(context.grants.map((g) => [`${g.roleName}|${g.scopeType}|${g.scopeId}`, { name: g.roleName, scopeType: g.scopeType, storeId: g.scopeId }])).values()];
    return {
      user: context,
      hasPin: Boolean(pinOwner?.pinHash),
      idleLockMinutes: (() => { const value = (settings?.settings as { idleLockMinutes?: unknown } | null)?.idleLockMinutes; return typeof value === 'number' && value >= 1 && value <= 240 ? value : 15; })(),
      onboardingRequired: onboarding?.required === true && onboarding.complete !== true,
      organisation,
      roles,
      permissions: {
        organization: organizationPermissions,
        stores: storePermissions,
      },
      stores,
    };
  }

  hasPermission(context: UserContext, permissionCode: string, storeId?: string): boolean {
    if (context.isOrganisationAdministrator) return true;
    const relevant = context.grants.filter((grant) => {
      if (grant.permissionCode !== permissionCode) return false;
      if (grant.scopeType === 'ORGANIZATION') return true;
      return Boolean(storeId && grant.scopeType === 'STORE' && grant.scopeId === storeId);
    });
    if (relevant.some((grant) => grant.effect === 'DENY')) return false;
    return relevant.some((grant) => grant.effect === 'ALLOW' || grant.effect === 'REQUIRE_APPROVAL');
  }

  permissionEffect(context: UserContext, permissionCode: string, storeId?: string): PermissionGrant['effect'] | null {
    if (context.isOrganisationAdministrator) return 'ALLOW';
    const relevant = context.grants.filter((grant) => {
      if (grant.permissionCode !== permissionCode) return false;
      if (grant.scopeType === 'ORGANIZATION') return true;
      return Boolean(storeId && grant.scopeType === 'STORE' && grant.scopeId === storeId);
    });
    if (relevant.some((grant) => grant.effect === 'DENY')) return 'DENY';
    if (relevant.some((grant) => grant.effect === 'REQUIRE_APPROVAL')) return 'REQUIRE_APPROVAL';
    return relevant.some((grant) => grant.effect === 'ALLOW') ? 'ALLOW' : null;
  }

  canAccessStore(context: UserContext, storeId: string): boolean {
    if (context.isOrganisationAdministrator) return true;
    return context.storeIds.includes(storeId) || context.grants.some(
      (grant) => grant.scopeType === 'STORE' && grant.scopeId === storeId,
    );
  }

  /** Stores where a permission is effective; undefined means organisation-wide access. */
  async permittedStoreIds(context: UserContext, permissionCode: string): Promise<string[] | undefined> {
    if (context.isOrganisationAdministrator) return undefined;

    const organizationGrants = context.grants.filter(
      (grant) => grant.permissionCode === permissionCode && grant.scopeType === 'ORGANIZATION',
    );
    if (organizationGrants.some((grant) => grant.effect === 'DENY')) return [];

    const organizationWide = organizationGrants.some(
      (grant) => grant.effect === 'ALLOW' || grant.effect === 'REQUIRE_APPROVAL',
    );
    const candidates = organizationWide
      ? (await this.prisma.store.findMany({
          where: { organizationId: context.organizationId },
          select: { id: true },
        })).map((store) => store.id)
      : [...new Set([
          ...context.storeIds,
          ...context.grants
            .filter((grant) => grant.scopeType === 'STORE' && grant.scopeId)
            .map((grant) => grant.scopeId as string),
        ])];

    return candidates.filter((storeId) => this.hasPermission(context, permissionCode, storeId));
  }

  assertPermissions(context: UserContext, permissionCodes: string[], storeId?: string): void {
    const missing = permissionCodes.filter((permission) => !this.hasPermission(context, permission, storeId));
    if (missing.length > 0) throw new ForbiddenException(`Missing permission: ${missing.join(', ')}`);
  }

  assertStoreAccess(context: UserContext, storeId: string): void {
    if (!this.canAccessStore(context, storeId)) throw new ForbiddenException('User does not have access to this store');
  }
}

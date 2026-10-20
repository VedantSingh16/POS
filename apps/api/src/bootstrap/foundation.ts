import type { PrismaClient } from '../generated/prisma/client.js';
import { ORGANISATION_ADMINISTRATOR_ROLE, PERMISSIONS, SYSTEM_ROLES } from '../auth/permission-catalogue.js';
import { hashPassword } from '../security/password.js';

export type FoundationConfig = {
  organizationName: string;
  organizationSlug: string;
  maxStores: number;
  adminEmail: string;
  adminPassword: string;
};

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

export function foundationConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FoundationConfig {
  const maxStores = Number.parseInt(requiredEnv(env, 'POS_MAX_STORES'), 10);
  const adminPassword = requiredEnv(env, 'POS_ORG_ADMIN_PASSWORD');
  if (adminPassword.length < 12) throw new Error('POS_ORG_ADMIN_PASSWORD must be at least 12 characters');
  return {
    organizationName: requiredEnv(env, 'POS_ORGANIZATION_NAME'),
    organizationSlug: requiredEnv(env, 'POS_ORGANIZATION_SLUG'),
    maxStores: Number.isFinite(maxStores) && maxStores >= 0 ? maxStores : 5,
    adminEmail: requiredEnv(env, 'POS_ORG_ADMIN_EMAIL').toLowerCase(),
    adminPassword,
  };
}

/**
 * Idempotently provisions the bootstrap organisation, the permission catalogue, the system roles and
 * the first Organisation Administrator. Safe to run on every start-up and from `prisma db seed`.
 * The store limit is platform entitlement data: it is re-applied from configuration on each run.
 */
export async function seedFoundation(prisma: PrismaClient, config: FoundationConfig): Promise<{ organizationId: string }> {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { slug: config.organizationSlug },
      create: { name: config.organizationName, slug: config.organizationSlug },
      update: {},
    });
    await tx.organizationEntitlement.upsert({
      where: { organizationId: organization.id },
      create: { organizationId: organization.id, maxStores: config.maxStores },
      update: { maxStores: config.maxStores },
    });
    const organizationSettings = await tx.organizationSettings.upsert({
      where: { organizationId: organization.id },
      create: { organizationId: organization.id, settings: { enabledTenders: ['CASH'], onboarding: { version: 2, currentStep: 0, completedSteps: [], complete: false, required: true } } },
      update: {},
    });
    const settings = organizationSettings.settings && typeof organizationSettings.settings === 'object' && !Array.isArray(organizationSettings.settings)
      ? organizationSettings.settings as Record<string, unknown>
      : {};
    const priorOnboarding = settings.onboarding && typeof settings.onboarding === 'object' && !Array.isArray(settings.onboarding)
      ? settings.onboarding as Record<string, unknown>
      : {};
    if (priorOnboarding.complete !== true && priorOnboarding.required !== true) {
      await tx.organizationSettings.update({
        where: { organizationId: organization.id },
        data: { settings: { ...settings, onboarding: { currentStep: 0, completedSteps: [], ...priorOnboarding, complete: false, required: true } } },
      });
    }

    await tx.permission.createMany({
      data: PERMISSIONS.map(([code, description]) => ({ code, description })),
      skipDuplicates: true,
    });

    const roleIds = new Map<string, string>();
    for (const definition of SYSTEM_ROLES) {
      const existing = await tx.role.findUnique({ where: { organizationId_name: { organizationId: organization.id, name: definition.name } } });
      // Once an admin customises a system role's permissions away from its template (customizedAt is set),
      // startup stops overwriting it: an edit must survive the next restart or deploy. It still gets a
      // template/storeAssignable backfill on first upgrade to this version (existing is null -> create path),
      // but an already-customised role's storeAssignable and permissions are left exactly as set.
      const isCustomized = Boolean(existing?.customizedAt);
      const role = await tx.role.upsert({
        where: { organizationId_name: { organizationId: organization.id, name: definition.name } },
        create: {
          organizationId: organization.id,
          name: definition.name,
          description: definition.description,
          isSystem: true,
          storeAssignable: definition.storeAssignable ?? false,
          templateKey: definition.templateKey,
          templateVersion: definition.templateVersion,
        },
        update: isCustomized
          ? { templateKey: existing?.templateKey ?? definition.templateKey }
          : { storeAssignable: definition.storeAssignable ?? false, templateKey: definition.templateKey, templateVersion: definition.templateVersion },
      });
      roleIds.set(definition.name, role.id);
      if (isCustomized) continue;
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: definition.permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })),
        skipDuplicates: true,
      });
    }

    const admin = await tx.user.findUnique({
      where: { organizationId_email: { organizationId: organization.id, email: config.adminEmail } },
    }) ?? await tx.user.create({
      data: {
        organizationId: organization.id,
        email: config.adminEmail,
        passwordHash: hashPassword(config.adminPassword),
        firstName: 'Organisation',
        lastName: 'Administrator',
      },
    });

    const adminRoleId = roleIds.get(ORGANISATION_ADMINISTRATOR_ROLE)!;
    const hasAdminRole = await tx.userRole.findFirst({
      where: { userId: admin.id, roleId: adminRoleId, scopeType: 'ORGANIZATION' },
      select: { id: true },
    });
    if (!hasAdminRole) {
      await tx.userRole.create({
        data: { organizationId: organization.id, userId: admin.id, roleId: adminRoleId, scopeType: 'ORGANIZATION' },
      });
    }
    return { organizationId: organization.id };
  });
}

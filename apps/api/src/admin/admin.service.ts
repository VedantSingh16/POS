import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { UserContext } from '../auth/auth.types.js';
import { ORGANISATION_ADMINISTRATOR_ROLE, PERMISSIONS } from '../auth/permission-catalogue.js';
import { JsonObject, money, oneOf, optionalString, requiredString, stringArray, uuid } from '../common/input.js';
import { isUniqueViolation, Tx } from '../database/db.js';
import { PrismaService } from '../database/prisma.service.js';
import { PermissionEffect, Prisma, ProductStatus, RecordStatus, UserStatus } from '../generated/prisma/client.js';

type RoleAssignmentInput = { roleId: string; scopeType: 'ORGANIZATION' | 'STORE'; storeId: string | null };

const USER_STATUSES: readonly string[] = Object.values(UserStatus);
const RECORD_STATUSES: readonly string[] = Object.values(RecordStatus);
const PRODUCT_STATUSES: readonly string[] = Object.values(ProductStatus);

const SETTINGS_KEYS = ['receiptFooter', 'defaultStoreId', 'inventoryPolicy', 'cashRounding', 'storeCloseHour', 'idleLockMinutes', 'onboarding'] as const;

const userInclude = {
  roles: { include: { role: { select: { id: true, name: true } } }, orderBy: { role: { name: 'asc' } } },
  stores: { select: { storeId: true } },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const productInclude = {
  category: { select: { id: true, name: true } },
  brandRef: { select: { id: true, name: true } },
  variants: {
    orderBy: { name: 'asc' },
    include: {
      uom: { select: { code: true } },
      taxGroup: { select: { code: true } },
      barcodes: { select: { code: true }, orderBy: { code: 'asc' } },
      prices: { orderBy: { effectiveFrom: 'desc' } },
    },
  },
} satisfies Prisma.ProductInclude;

type ProductWithVariants = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Organisation ─────────────

  async getOverview(context: UserContext) {
    this.requireOrganizationPermission(context, 'org.overview.view');
    const organizationId = context.organizationId;
    const [organization, entitlement, activeStores, activeUsers, activeRegisters] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.organizationEntitlement.findUnique({ where: { organizationId } }),
      this.prisma.store.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.register.count({ where: { organizationId, status: 'ACTIVE' } }),
    ]);
    if (!organization) throw new NotFoundException('Organisation not found');
    const maxStores = entitlement?.maxStores ?? 0;
    return {
      organization,
      entitlement: { maxStores, currentStores: activeStores, remainingStores: Math.max(0, maxStores - activeStores) },
      counts: { activeUsers, activeRegisters },
      administrator: context,
    };
  }

  async updateOrganization(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const organization = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id: context.organizationId },
        data: {
          ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
          ...(optionalString(input.legalName) !== undefined ? { legalName: optionalString(input.legalName) } : {}),
          ...(optionalString(input.tradeName) !== undefined ? { tradeName: optionalString(input.tradeName) } : {}),
          ...(optionalString(input.address) !== undefined ? { address: optionalString(input.address) } : {}),
          ...(optionalString(input.gstin) !== undefined ? { gstin: optionalString(input.gstin)?.toUpperCase() } : {}),
          ...(optionalString(input.businessType) !== undefined ? { businessType: optionalString(input.businessType)?.toUpperCase() } : {}),
          ...(optionalString(input.timezone) !== undefined ? { timezone: optionalString(input.timezone) } : {}),
        },
      });
      await this.audit.record(context, 'organization.updated', 'Organization', updated.id, { fields: Object.keys(input) }, tx);
      return updated;
    });
    return organization;
  }

  async getSettings(context: UserContext) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const row = await this.prisma.organizationSettings.findUnique({ where: { organizationId: context.organizationId } });
    return { settings: (row?.settings ?? {}) as JsonObject };
  }

  async updateSettings(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const next: JsonObject = { ...(await this.getSettings(context)).settings };
    for (const key of SETTINGS_KEYS) {
      if (key in input) next[key] = input[key];
    }
    if ('idleLockMinutes' in input) {
      const minutes = Number(input.idleLockMinutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new BadRequestException('idleLockMinutes must be a whole number from 1 to 240');
      next.idleLockMinutes = minutes;
    }
    if ('receiptFooter' in input && (typeof input.receiptFooter !== 'string' || input.receiptFooter.length > 300)) throw new BadRequestException('receiptFooter must be text of at most 300 characters');
    if (typeof next.defaultStoreId === 'string') {
      await this.ensureStore(context.organizationId, uuid(next.defaultStoreId, 'defaultStoreId'));
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationSettings.upsert({
        where: { organizationId: context.organizationId },
        create: { organizationId: context.organizationId, settings: next as Prisma.InputJsonObject },
        update: { settings: next as Prisma.InputJsonObject },
      });
      await this.audit.record(context, 'organization.settings.updated', 'OrganizationSettings', context.organizationId, { keys: Object.keys(input) }, tx);
    });
    return { settings: next };
  }

  async getApprovalPolicy(context: UserContext) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const policy = await this.prisma.approvalPolicy.findUnique({ where: { organizationId_action: { organizationId: context.organizationId, action: 'SALE_DISCOUNT' } } });
    return { action: 'SALE_DISCOUNT', enabled: policy ? policy.status === 'ACTIVE' : true, thresholdPercent: policy?.thresholdPercent === null || policy === null ? 10 : Number(policy.thresholdPercent) };
  }

  async updateApprovalPolicy(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const thresholdPercent = Number(input.thresholdPercent);
    if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) throw new BadRequestException('thresholdPercent must be between 0 and 100');
    const status = input.enabled === false ? 'DISABLED' : 'ACTIVE';
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalPolicy.upsert({
        where: { organizationId_action: { organizationId: context.organizationId, action: 'SALE_DISCOUNT' } },
        create: { organizationId: context.organizationId, action: 'SALE_DISCOUNT', thresholdPercent, status },
        update: { thresholdPercent, status },
      });
      await this.audit.record(context, 'approval-policy.updated', 'ApprovalPolicy', 'SALE_DISCOUNT', { thresholdPercent, status }, tx);
    });
    return this.getApprovalPolicy(context);
  }

  async listAuditLogs(context: UserContext) {
    this.requireOrganizationPermission(context, 'audit.view');
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return logs.map(({ organizationId: _organizationId, ...log }) => log);
  }

  async getUser(context: UserContext, userId: string) {
    this.requireOrganizationPermission(context, 'users.view');
    return this.getUserRecord(context, uuid(userId, 'userId'));
  }

  async effectiveAccess(context: UserContext, userId: string) {
    this.requireOrganizationPermission(context, 'users.view');
    const user = await this.prisma.user.findFirst({
      where: { id: uuid(userId, 'userId'), organizationId: context.organizationId },
      include: {
        roles: {
          include: {
            role: { include: { permissions: { select: { permissionCode: true, effect: true } } } },
            store: { select: { id: true, code: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      userId: user.id,
      grants: user.roles.flatMap((assignment) => assignment.role.permissions.map((permission) => ({
        permission: permission.permissionCode,
        sourceRole: assignment.role.name,
        scopeType: assignment.scopeType,
        store: assignment.store,
      }))),
    };
  }

  async listPermissionGroups() {
    const groups = new Map<string, { group: string; codes: string[] }>();
    for (const [code] of PERMISSIONS) {
      const group = code.split('.')[0] ?? 'other';
      const title = group === 'org' ? 'Organisation' : group.charAt(0).toUpperCase() + group.slice(1);
      const value = groups.get(group) ?? { group: title, codes: [] };
      value.codes.push(code);
      groups.set(group, value);
    }
    return [...groups.values()];
  }

  // ───────────── Users ─────────────

  async listUsers(context: UserContext) {
    this.requireOrganizationPermission(context, 'users.view');
    const users = await this.prisma.user.findMany({
      where: { organizationId: context.organizationId },
      include: userInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    });
    return users.map((user) => this.userDto(user));
  }

  async listStoreStaff(context: UserContext, storeId: string) {
    const id = uuid(storeId, 'storeId');
    this.authorizationStoreAccess(context, id);
    this.authorization.assertPermissions(context, ['store.staff.view'], id);
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: context.organizationId,
        OR: [
          { stores: { some: { storeId: id } } },
          { roles: { some: { scopeType: 'STORE', storeId: id } } },
        ],
      },
      include: userInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    });
    return users.map((user) => ({
      ...this.userDto(user),
      // The store staff view must not disclose the user's other store assignments.
      defaultStoreId: user.defaultStoreId === id ? id : null,
      storeIds: [id],
      roles: user.roles.filter((assignment) => assignment.scopeType === 'STORE' && assignment.storeId === id).map((assignment) => ({
        id: assignment.role.id,
        name: assignment.role.name,
        scopeType: assignment.scopeType,
        scopeId: id,
      })),
    }));
  }

  async createUser(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'users.manage');
    const email = this.email(input.email);
    const password = requiredString(input.password, 'password');
    if (password.length < 12) throw new BadRequestException('Password must be at least 12 characters');
    const firstName = requiredString(input.firstName, 'firstName');
    const lastName = optionalString(input.lastName) ?? '';
    const requestedStoreIds = stringArray(input.storeIds).map((id) => uuid(id, 'storeIds'));
    const assignments = this.roleAssignments(input);
    if (assignments.length === 0) throw new BadRequestException('At least one role is required');
    const storeIds = [...new Set([...requestedStoreIds, ...assignments.flatMap((assignment) => assignment.storeId ? [assignment.storeId] : [])])];
    await this.validateAccess(context.organizationId, storeIds, assignments);

    try {
      const userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            organizationId: context.organizationId,
            email,
            passwordHash: this.auth.hashPassword(password),
            firstName,
            lastName,
            defaultStoreId: storeIds[0] ?? null,
          },
        });
        await this.writeAccess(tx, context.organizationId, user.id, assignments, storeIds);
        await this.audit.record(context, 'user.created', 'User', user.id, { email }, tx);
        return user.id;
      });
      return await this.getUserRecord(context, userId);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A user with this email already exists');
      throw error;
    }
  }

  async updateUser(context: UserContext, userId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'users.manage');
    const user = await this.ensureUser(context.organizationId, userId);
    const nextStatus = typeof input.status === 'string' ? input.status.toUpperCase() : undefined;
    if (nextStatus && !USER_STATUSES.includes(nextStatus)) throw new BadRequestException('Invalid user status');
    const newPassword = typeof input.password === 'string' && input.password.length ? input.password : undefined;
    if (newPassword && newPassword.length < 12) throw new BadRequestException('Password must be at least 12 characters');
    if (user.status === 'ACTIVE' && nextStatus && nextStatus !== 'ACTIVE') {
      await this.assertNotLastAdministrator(context.organizationId, userId);
    }

    const requestedStoreIds = input.storeIds === undefined ? undefined : stringArray(input.storeIds).map((id) => uuid(id, 'storeIds'));
    const assignments = input.roleIds === undefined && input.roleAssignments === undefined ? undefined : this.roleAssignments(input);
    if (assignments && assignments.length === 0) throw new BadRequestException('At least one role is required');
    const previousStoreIds = requestedStoreIds === undefined && assignments ? (await this.prisma.userStore.findMany({ where: { userId }, select: { storeId: true } })).map((row) => row.storeId) : [];
    const storeIds = requestedStoreIds === undefined
      ? (assignments ? [...new Set([...previousStoreIds, ...assignments.flatMap((assignment) => assignment.storeId ? [assignment.storeId] : [])])] : undefined)
      : [...new Set([...requestedStoreIds, ...(assignments ?? []).flatMap((assignment) => assignment.storeId ? [assignment.storeId] : [])])];
    await this.validateAccess(context.organizationId, storeIds ?? [], assignments ?? []);
    if (assignments) {
      const stillAdministrator = await this.holdsAdministratorRole(assignments);
      if (!stillAdministrator) await this.assertNotLastAdministrator(context.organizationId, userId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          firstName: optionalString(input.firstName) ?? user.firstName,
          lastName: optionalString(input.lastName) ?? user.lastName,
          ...(nextStatus ? { status: nextStatus as UserStatus } : {}),
          ...(newPassword ? { passwordHash: this.auth.hashPassword(newPassword), failedAttempts: 0, lockedUntil: null } : {}),
          ...(storeIds ? { defaultStoreId: storeIds[0] ?? null } : {}),
        },
      });
      if (storeIds) await tx.userStore.deleteMany({ where: { userId } });
      if (assignments) await tx.userRole.deleteMany({ where: { userId } });
      await this.writeAccess(tx, context.organizationId, userId, assignments ?? [], storeIds ?? []);
      await this.audit.record(context, 'user.updated', 'User', userId, { status: nextStatus, passwordReset: Boolean(newPassword), storeIdsChanged: Boolean(storeIds), rolesChanged: Boolean(assignments) }, tx);
    });
    return this.getUserRecord(context, userId);
  }

  // ───────────── Roles ─────────────

  async listRoles(context: UserContext) {
    this.requireOrganizationPermission(context, 'roles.view');
    const roles = await this.prisma.role.findMany({
      where: { organizationId: context.organizationId },
      include: {
        permissions: { select: { permissionCode: true, effect: true }, orderBy: { permissionCode: 'asc' } },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map((role) => ({
      ...this.roleDto(role),
      userCount: role._count.assignments,
      permissionCount: role.permissions.filter((permission) => permission.effect !== 'DENY').length,
    }));
  }

  async getRole(context: UserContext, roleId: string) {
    this.requireOrganizationPermission(context, 'roles.view');
    const role = await this.prisma.role.findFirst({
      where: { id: uuid(roleId, 'roleId'), organizationId: context.organizationId },
      include: { permissions: { select: { permissionCode: true, effect: true }, orderBy: { permissionCode: 'asc' } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return this.roleDto(role);
  }

  async createRole(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'roles.manage');
    const name = requiredString(input.name, 'name');
    const description = optionalString(input.description) ?? '';
    const permissions = stringArray(input.permissions);
    await this.ensurePermissions(permissions);
    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.role.create({
          data: {
            organizationId: context.organizationId,
            name,
            description,
            permissions: { create: [...new Set(permissions)].map((permissionCode) => ({ permissionCode, effect: this.permissionEffect(input, permissionCode) })) },
          },
          include: { permissions: { select: { permissionCode: true, effect: true }, orderBy: { permissionCode: 'asc' } } },
        });
        await this.audit.record(context, 'role.created', 'Role', created.id, { name, permissions }, tx);
        return created;
      });
      return this.roleDto(role);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A role with this name already exists');
      throw error;
    }
  }

  async updateRole(context: UserContext, roleId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'roles.manage');
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: context.organizationId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new BadRequestException('System roles cannot be edited');

    const status = typeof input.status === 'string' ? input.status.toUpperCase() : undefined;
    if (status && !RECORD_STATUSES.includes(status)) throw new BadRequestException('Invalid role status');
    if (status === 'DISABLED' && (await this.prisma.userRole.count({ where: { roleId } })) > 0) {
      throw new ConflictException('Reassign users before disabling this role');
    }
    const permissions = input.permissions === undefined ? undefined : stringArray(input.permissions);
    if (permissions) await this.ensurePermissions(permissions);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.role.update({
          where: { id: roleId },
          data: {
            name: optionalString(input.name) || role.name,
            ...(optionalString(input.description) !== undefined ? { description: optionalString(input.description) } : {}),
            ...(status ? { status: status as RecordStatus } : {}),
          },
        });
        if (permissions) {
          await tx.rolePermission.deleteMany({ where: { roleId } });
          await tx.rolePermission.createMany({ data: [...new Set(permissions)].map((permissionCode) => ({ roleId, permissionCode, effect: this.permissionEffect(input, permissionCode) })) });
        }
        await this.audit.record(context, 'role.updated', 'Role', roleId, { name: input.name, status, permissionsChanged: Boolean(permissions) }, tx);
        return tx.role.findUniqueOrThrow({
          where: { id: roleId },
          include: { permissions: { select: { permissionCode: true, effect: true }, orderBy: { permissionCode: 'asc' } } },
        });
      });
      return this.roleDto(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A role with this name already exists');
      throw error;
    }
  }

  // ───────────── Stores & registers ─────────────

  async listStores(context: UserContext) {
    const permittedStoreIds = await this.authorization.permittedStoreIds(context, 'stores.view');
    const stores = await this.prisma.store.findMany({
      where: { organizationId: context.organizationId, ...(permittedStoreIds ? { id: { in: permittedStoreIds } } : {}) },
      include: { _count: { select: { registers: { where: { status: 'ACTIVE' } } } } },
      orderBy: { name: 'asc' },
    });
    const storeIds = stores.map((store) => store.id);
    // Staff counts and manager names are derived from real assignments. Names are only disclosed to callers who may list users.
    const staffCounts = storeIds.length
      ? await this.prisma.userStore.groupBy({ by: ['storeId'], where: { storeId: { in: storeIds }, user: { organizationId: context.organizationId, status: 'ACTIVE' } }, _count: { _all: true } })
      : [];
    const canSeeManagers = this.authorization.hasPermission(context, 'users.view');
    const managerRows = canSeeManagers && storeIds.length
      ? await this.prisma.userRole.findMany({
        where: { scopeType: 'STORE', storeId: { in: storeIds }, role: { organizationId: context.organizationId, name: 'Store Manager' }, user: { organizationId: context.organizationId, status: 'ACTIVE' } },
        select: { storeId: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      })
      : [];
    return stores.map(({ _count, organizationId: _organizationId, ...store }) => ({
      ...store,
      registerCount: _count.registers,
      staffCount: staffCounts.find((row) => row.storeId === store.id)?._count._all ?? 0,
      managers: managerRows
        .filter((row) => row.storeId === store.id)
        .map((row) => ({ id: row.user.id, name: `${row.user.firstName} ${row.user.lastName}`.trim(), email: row.user.email })),
    }));
  }

  async getStoreForContext(context: UserContext, storeId: string) {
    const id = uuid(storeId, 'storeId');
    this.authorizationStoreAccess(context, id);
    this.authorization.assertPermissions(context, ['stores.view'], id);
    return this.getStore(context, id);
  }

  async createStore(context: UserContext, input: JsonObject) {
    const code = requiredString(input.code, 'code').toUpperCase();
    const name = requiredString(input.name, 'name');
    const address = optionalString(input.address) ?? '';
    const timezone = optionalString(input.timezone) || 'Asia/Kolkata';
    const closeHour = input.closeHour === undefined || input.closeHour === null || input.closeHour === '' ? null : Number(input.closeHour);
    if (closeHour !== null && (!Number.isInteger(closeHour) || closeHour < 0 || closeHour > 23)) throw new BadRequestException('closeHour must be an integer from 0 to 23');

    try {
      const storeId = await this.prisma.$transaction(async (tx) => {
        // Serialise concurrent store creation for this organisation so the platform limit cannot be exceeded.
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${context.organizationId}::uuid FOR UPDATE`;
        const organization = await tx.organization.findUnique({ where: { id: context.organizationId }, select: { status: true } });
        if (!organization || organization.status !== 'ACTIVE') throw new BadRequestException('Organisation is not active');
        const entitlement = await tx.organizationEntitlement.findUnique({ where: { organizationId: context.organizationId } });
        const current = await tx.store.count({ where: { organizationId: context.organizationId, status: 'ACTIVE' } });
        if (!entitlement || current >= entitlement.maxStores) {
          throw new ConflictException(`Store limit reached (${entitlement?.maxStores ?? 0})`);
        }
        const store = await tx.store.create({ data: { organizationId: context.organizationId, code, name, address, timezone, closeHour } });
        await tx.stockLocation.create({
          data: { organizationId: context.organizationId, storeId: store.id, code: `${code}-STOCKROOM`, name: `${name} Stockroom` },
        });
        // A store cannot trade without a till, so a first register may be created in the same transaction.
        const firstRegister = input.register && typeof input.register === 'object' && !Array.isArray(input.register) ? input.register as JsonObject : null;
        if (firstRegister) {
          const created = await tx.register.create({
            data: { organizationId: context.organizationId, storeId: store.id, code: requiredString(firstRegister.code, 'register.code').toUpperCase(), name: requiredString(firstRegister.name, 'register.name') },
          });
          await this.audit.record(context, 'register.created', 'Register', created.id, { storeId: store.id, code: created.code }, tx);
        }
        await this.audit.record(context, 'store.created', 'Store', store.id, { code, name }, tx);
        return store.id;
      });
      return await this.getStore(context, storeId);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A store with this code already exists');
      throw error;
    }
  }

  async updateStore(context: UserContext, storeId: string, input: JsonObject) {
    await this.ensureStore(context.organizationId, storeId);
    const status = typeof input.status === 'string' ? input.status.toUpperCase() : undefined;
    if (status && !RECORD_STATUSES.includes(status)) throw new BadRequestException('Invalid store status');
    const closeHour = input.closeHour === undefined || input.closeHour === null || input.closeHour === '' ? undefined : Number(input.closeHour);
    if (closeHour !== undefined && (!Number.isInteger(closeHour) || closeHour < 0 || closeHour > 23)) throw new BadRequestException('closeHour must be an integer from 0 to 23');
    await this.prisma.$transaction(async (tx) => {
      await tx.store.update({
        where: { id: storeId },
        data: {
          ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
          ...(optionalString(input.address) !== undefined ? { address: optionalString(input.address) } : {}),
          ...(optionalString(input.timezone) ? { timezone: optionalString(input.timezone) } : {}),
          ...(closeHour !== undefined ? { closeHour } : {}),
          ...(status ? { status: status as RecordStatus } : {}),
        },
      });
      await this.audit.record(context, 'store.updated', 'Store', storeId, { status }, tx);
    });
    return this.getStore(context, storeId);
  }

  async getStoreSettings(context: UserContext, storeId: string) {
    const id = uuid(storeId, 'storeId');
    this.authorizationStoreAccess(context, id);
    this.authorization.assertPermissions(context, ['store.settings.view'], id);
    const store = await this.ensureStore(context.organizationId, id);
    return { id: store.id, code: store.code, name: store.name, address: store.address, timezone: store.timezone, closeHour: store.closeHour };
  }

  async updateStoreSettings(context: UserContext, storeId: string, input: JsonObject) {
    const id = uuid(storeId, 'storeId');
    this.authorizationStoreAccess(context, id);
    this.authorization.assertPermissions(context, ['store.settings.manage'], id);
    const closeHour = !('closeHour' in input) ? undefined : input.closeHour === null || input.closeHour === '' ? null : Number(input.closeHour);
    if (closeHour !== undefined && closeHour !== null && (!Number.isInteger(closeHour) || closeHour < 0 || closeHour > 23)) throw new BadRequestException('Close hour must be an integer from 0 to 23');
    await this.prisma.$transaction(async (tx) => {
      await tx.store.update({ where: { id }, data: {
        ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
        ...(optionalString(input.address) !== undefined ? { address: optionalString(input.address) ?? '' } : {}),
        ...(optionalString(input.timezone) ? { timezone: optionalString(input.timezone) } : {}),
        ...(closeHour !== undefined ? { closeHour } : {}),
      } });
      await this.audit.record(context, 'store.settings.updated', 'Store', id, { fields: Object.keys(input) }, tx);
    });
    return this.getStoreSettings(context, id);
  }

  async listRegisters(context: UserContext, storeId?: string) {
    const permittedStoreIds = await this.authorization.permittedStoreIds(context, 'registers.view');
    if (storeId) {
      await this.ensureStore(context.organizationId, storeId);
      this.authorizationStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['registers.view'], storeId);
    }
    const registers = await this.prisma.register.findMany({
      where: {
        organizationId: context.organizationId,
        ...(storeId ? { storeId } : permittedStoreIds ? { storeId: { in: permittedStoreIds } } : {}),
      },
      orderBy: [{ storeId: 'asc' }, { name: 'asc' }],
    });
    return registers.map((register) => this.registerDto(register));
  }

  async createRegister(context: UserContext, storeId: string, input: JsonObject) {
    await this.ensureStore(context.organizationId, storeId);
    const code = requiredString(input.code, 'code').toUpperCase();
    const name = requiredString(input.name, 'name');
    try {
      const register = await this.prisma.$transaction(async (tx) => {
        const created = await tx.register.create({ data: { organizationId: context.organizationId, storeId, code, name } });
        await this.audit.record(context, 'register.created', 'Register', created.id, { storeId, code }, tx);
        return created;
      });
      return this.registerDto(register);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A register with this code already exists in the store');
      throw error;
    }
  }

  async updateRegister(context: UserContext, registerId: string, input: JsonObject) {
    const register = await this.prisma.register.findFirst({ where: { id: registerId, organizationId: context.organizationId } });
    if (!register) throw new NotFoundException('Register not found');
    const status = typeof input.status === 'string' ? input.status.toUpperCase() : undefined;
    if (status && !RECORD_STATUSES.includes(status)) throw new BadRequestException('Invalid register status');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.register.update({
        where: { id: registerId },
        data: { ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}), ...(status ? { status: status as RecordStatus } : {}) },
      });
      await this.audit.record(context, 'register.updated', 'Register', registerId, { status }, tx);
      return result;
    });
    return this.registerDto(updated);
  }

  // ───────────── Catalogue ─────────────

  async listCategories(context: UserContext) {
    this.requireOrganizationPermission(context, 'catalog.view');
    const categories = await this.prisma.category.findMany({ where: { organizationId: context.organizationId }, orderBy: { name: 'asc' } });
    return categories.map(({ organizationId: _organizationId, ...category }) => category);
  }

  async createCategory(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const name = requiredString(input.name, 'name');
    const parentId = typeof input.parentId === 'string' ? uuid(input.parentId, 'parentId') : null;
    if (parentId && !(await this.prisma.category.findFirst({ where: { id: parentId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new BadRequestException('Parent category not found');
    }
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.category.create({ data: { organizationId: context.organizationId, parentId, name } });
      await this.audit.record(context, 'category.created', 'Category', created.id, { name }, tx);
      return created;
    });
    const { organizationId: _organizationId, ...dto } = category;
    return dto;
  }

  async listUoms(context: UserContext) {
    this.requireOrganizationPermission(context, 'catalog.view');
    const uoms = await this.prisma.unitOfMeasure.findMany({ where: { organizationId: context.organizationId }, orderBy: { name: 'asc' } });
    return uoms.map(({ organizationId: _organizationId, ...uom }) => uom);
  }

  async createUom(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const code = requiredString(input.code, 'code').toUpperCase();
    const name = requiredString(input.name, 'name');
    try {
      const uom = await this.prisma.$transaction(async (tx) => {
        const created = await tx.unitOfMeasure.create({
          data: { organizationId: context.organizationId, code, name, allowsDecimal: input.allowsDecimal === true },
        });
        await this.audit.record(context, 'uom.created', 'UnitOfMeasure', created.id, { code }, tx);
        return created;
      });
      const { organizationId: _organizationId, ...dto } = uom;
      return dto;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A unit of measure with this code already exists');
      throw error;
    }
  }

  async listTaxGroups(context: UserContext) {
    this.requireOrganizationPermission(context, 'tax.view');
    const groups = await this.prisma.taxGroup.findMany({ where: { organizationId: context.organizationId, storeId: null }, orderBy: { name: 'asc' } });
    return groups.map((group) => this.taxGroupDto(group));
  }

  async createTaxGroup(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'tax.manage');
    const code = requiredString(input.code, 'code').toUpperCase();
    const name = requiredString(input.name, 'name');
    const ratePercent = Number(input.ratePercent);
    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      throw new BadRequestException('ratePercent must be between 0 and 100');
    }
    try {
      const group = await this.prisma.$transaction(async (tx) => {
        const created = await tx.taxGroup.create({
          data: { organizationId: context.organizationId, code, name, hsnCode: optionalString(input.hsnCode) ?? '', rateBps: Math.round(ratePercent * 100), includesTax: input.includesTax === true },
        });
        await this.audit.record(context, 'tax-group.created', 'TaxGroup', created.id, { code, ratePercent }, tx);
        return created;
      });
      return this.taxGroupDto(group);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A tax group with this code already exists');
      throw error;
    }
  }

  async updateTaxGroup(context: UserContext, taxGroupId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'tax.manage');
    const id = uuid(taxGroupId, 'taxGroupId');
    const group = await this.prisma.taxGroup.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!group) throw new NotFoundException('Tax group not found');
    const ratePercent = input.ratePercent === undefined ? undefined : Number(input.ratePercent);
    if (ratePercent !== undefined && (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100)) throw new BadRequestException('ratePercent must be between 0 and 100');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.taxGroup.update({ where: { id }, data: { ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}), ...(optionalString(input.hsnCode) !== undefined ? { hsnCode: optionalString(input.hsnCode) } : {}), ...(ratePercent !== undefined ? { rateBps: Math.round(ratePercent * 100) } : {}), ...(input.includesTax !== undefined ? { includesTax: input.includesTax === true } : {}) } });
      await this.audit.record(context, 'tax-group.updated', 'TaxGroup', id, { fields: Object.keys(input) }, tx);
      return result;
    });
    return this.taxGroupDto(updated);
  }

  async listProducts(context: UserContext) {
    this.requireOrganizationPermission(context, 'catalog.view');
    const products = await this.prisma.product.findMany({
      where: { organizationId: context.organizationId },
      include: productInclude,
      orderBy: { name: 'asc' },
    });
    return products.map((product) => this.productDto(product));
  }

  async getProduct(context: UserContext, productId: string) {
    this.requireOrganizationPermission(context, 'catalog.view');
    const product = await this.prisma.product.findFirst({ where: { id: uuid(productId, 'productId'), organizationId: context.organizationId }, include: productInclude });
    if (!product) throw new NotFoundException('Product not found');
    return this.productDto(product);
  }

  async listBrands(context: UserContext) {
    this.requireOrganizationPermission(context, 'catalog.view');
    const brands = await this.prisma.brand.findMany({
      where: { organizationId: context.organizationId },
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
    return brands.map((brand) => ({ id: brand.id, name: brand.name, products: brand._count.products, status: brand.status }));
  }

  async createBrand(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const name = requiredString(input.name, 'name').trim();
    if (name.length < 1 || name.length > 80) throw new BadRequestException('Brand name must be 1 to 80 characters');
    try {
      const brand = await this.prisma.$transaction(async (tx) => {
        const created = await tx.brand.create({ data: { organizationId: context.organizationId, name } });
        await this.audit.record(context, 'brand.created', 'Brand', created.id, { name }, tx);
        return created;
      });
      return { id: brand.id, name: brand.name, products: 0, status: brand.status };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A brand with this name already exists');
      throw error;
    }
  }

  async updateBrand(context: UserContext, brandId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const id = uuid(brandId, 'brandId');
    const current = await this.prisma.brand.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Brand not found');
    const name = input.name === undefined ? undefined : requiredString(input.name, 'name').trim();
    const status = input.status === undefined ? undefined : oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status');
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.brand.update({ where: { id }, data: { ...(name !== undefined ? { name } : {}), ...(status ? { status } : {}) } });
        await this.audit.record(context, 'brand.updated', 'Brand', id, { fields: Object.keys(input) }, tx);
        return result;
      });
      return { id: updated.id, name: updated.name, status: updated.status };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A brand with this name already exists');
      throw error;
    }
  }

  async deleteBrand(context: UserContext, brandId: string) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const id = uuid(brandId, 'brandId');
    const brand = await this.prisma.brand.findFirst({ where: { id, organizationId: context.organizationId }, include: { _count: { select: { products: true } } } });
    if (!brand) throw new NotFoundException('Brand not found');
    if (brand._count.products > 0) throw new ConflictException('Brand is used by products; disable it instead');
    await this.prisma.$transaction(async (tx) => {
      await tx.brand.delete({ where: { id } });
      await this.audit.record(context, 'brand.deleted', 'Brand', id, { name: brand.name }, tx);
    });
    return { id };
  }

  async updateProduct(context: UserContext, productId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const id = uuid(productId, 'productId');
    const current = await this.prisma.product.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Product not found');
    const status = input.status === undefined ? undefined : this.productStatus(input.status);
    const categoryId = input.categoryId === null ? null : input.categoryId === undefined ? undefined : uuid(input.categoryId, 'categoryId');
    if (categoryId && !(await this.prisma.category.findFirst({ where: { id: categoryId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new BadRequestException('Category not found');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
          ...(optionalString(input.description) !== undefined ? { description: optionalString(input.description) } : {}),
          ...(optionalString(input.brand) !== undefined ? { brand: optionalString(input.brand) } : {}),
          ...(input.brandId === null ? { brandId: null, brand: '' } : input.brandId !== undefined ? { brandId: uuid(input.brandId, 'brandId') } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
          ...(status ? { status } : {}),
        },
        include: productInclude,
      });
      await this.audit.record(context, 'product.updated', 'Product', id, { fields: Object.keys(input) }, tx);
      return product;
    });
    return this.productDto(updated);
  }

  async createProduct(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const name = requiredString(input.name, 'name');
    const categoryId = typeof input.categoryId === 'string' ? uuid(input.categoryId, 'categoryId') : null;
    if (categoryId && !(await this.prisma.category.findFirst({ where: { id: categoryId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new BadRequestException('Category not found');
    }
    const brandId = typeof input.brandId === 'string' ? uuid(input.brandId, 'brandId') : null;
    let brandName = optionalString(input.brand) ?? '';
    if (brandId) {
      const brand = await this.prisma.brand.findFirst({ where: { id: brandId, organizationId: context.organizationId }, select: { name: true } });
      if (!brand) throw new BadRequestException('Brand not found');
      brandName = brand.name;
    }
    const status = this.productStatus(input.status);
    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          organizationId: context.organizationId,
          categoryId,
          brandId,
          name,
          description: optionalString(input.description) ?? '',
          brand: brandName,
          status,
        },
        include: productInclude,
      });
      await this.audit.record(context, 'product.created', 'Product', created.id, { name }, tx);
      return created;
    });
    return this.productDto(product);
  }

  async createVariant(context: UserContext, productId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId: context.organizationId }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const sku = requiredString(input.sku, 'sku').toUpperCase();
    const name = requiredString(input.name, 'name');
    const uomId = typeof input.uomId === 'string' ? uuid(input.uomId, 'uomId') : null;
    const taxGroupId = typeof input.taxGroupId === 'string' ? uuid(input.taxGroupId, 'taxGroupId') : null;
    if (uomId && !(await this.prisma.unitOfMeasure.findFirst({ where: { id: uomId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new BadRequestException('Unit of measure not found');
    }
    if (taxGroupId && !(await this.prisma.taxGroup.findFirst({ where: { id: taxGroupId, organizationId: context.organizationId, storeId: null }, select: { id: true } }))) {
      throw new BadRequestException('Tax group not found');
    }
    let amountCents: number | undefined;
    if (input.amountCents !== undefined) {
      amountCents = Number(input.amountCents);
      if (!Number.isInteger(amountCents) || amountCents < 0) throw new BadRequestException('amountCents must be a non-negative integer');
    }
    const barcode = optionalString(input.barcode);
    const status = this.productStatus(input.status);
    const costCents = input.costCents === undefined ? 0 : money(input.costCents, 'costCents');

    try {
      await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.create({
          data: { organizationId: context.organizationId, productId, sku, name, status, uomId, taxGroupId, costCents },
        });
        if (barcode) await tx.barcode.create({ data: { organizationId: context.organizationId, variantId: variant.id, code: barcode } });
        if (amountCents !== undefined) {
          await tx.variantPrice.create({
            data: {
              organizationId: context.organizationId,
              variantId: variant.id,
              amountCents,
              currency: optionalString(input.currency) || 'INR',
              includesTax: input.includesTax === true,
            },
          });
        }
        await this.audit.record(context, 'product-variant.created', 'ProductVariant', variant.id, { productId, sku }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('SKU or barcode already exists');
      throw error;
    }
    const updated = await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    return this.productDto(updated);
  }

  async updateVariant(context: UserContext, variantId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const id = uuid(variantId, 'variantId');
    const current = await this.prisma.productVariant.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Variant not found');
    const status = input.status === undefined ? undefined : this.productStatus(input.status);
    const costCents = input.costCents === undefined ? undefined : money(input.costCents, 'costCents');
    const uomId = input.uomId === null ? null : input.uomId === undefined ? undefined : uuid(input.uomId, 'uomId');
    const taxGroupId = input.taxGroupId === null ? null : input.taxGroupId === undefined ? undefined : uuid(input.taxGroupId, 'taxGroupId');
    if (uomId && !(await this.prisma.unitOfMeasure.findFirst({ where: { id: uomId, organizationId: context.organizationId }, select: { id: true } }))) throw new BadRequestException('Unit of measure not found');
    if (taxGroupId && !(await this.prisma.taxGroup.findFirst({ where: { id: taxGroupId, organizationId: context.organizationId, storeId: null }, select: { id: true } }))) throw new BadRequestException('Tax group not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.update({ where: { id }, data: {
        ...(optionalString(input.sku) ? { sku: optionalString(input.sku)?.toUpperCase() } : {}),
        ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
        ...(status ? { status } : {}),
        ...(costCents !== undefined ? { costCents } : {}),
        ...(uomId !== undefined ? { uomId } : {}),
        ...(taxGroupId !== undefined ? { taxGroupId } : {}),
      } });
      if (Array.isArray(input.barcodes)) {
        const codes = stringArray(input.barcodes);
        const conflicting = await tx.barcode.findFirst({ where: { organizationId: context.organizationId, code: { in: codes }, variantId: { not: id } }, select: { code: true } });
        if (conflicting) throw new ConflictException(`Barcode already exists: ${conflicting.code}`);
        await tx.barcode.deleteMany({ where: { variantId: id } });
        if (codes.length) await tx.barcode.createMany({ data: [...new Set(codes)].map((code) => ({ organizationId: context.organizationId, variantId: id, code })) });
      }
      if (input.amountCents !== undefined) {
        const amountCents = money(input.amountCents);
        await tx.variantPrice.create({ data: { organizationId: context.organizationId, variantId: id, amountCents, currency: optionalString(input.currency) || 'INR', includesTax: input.includesTax === true } });
      }
      await this.audit.record(context, 'product-variant.updated', 'ProductVariant', id, { fields: Object.keys(input) }, tx);
      return variant;
    });
    return this.getProduct(context, updated.productId);
  }

  async previewCatalogImport(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const rows = this.importRows(input.rows);
    const errors: { row: number; field: string; message: string }[] = [];
    const seenSkus = new Set<string>();
    const seenBarcodes = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const sku = typeof row.sku === 'string' ? row.sku.trim().toUpperCase() : '';
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      const hasPriceCents = row.priceCents !== undefined;
      const price = Number(hasPriceCents ? row.priceCents : row.price);
      const barcode = typeof row.barcode === 'string' ? row.barcode.trim() : '';
      const rate = Number(row.ratePercent ?? row.gst ?? 0);
      const cost = row.costCents === undefined ? 0 : Number(row.costCents);
      if (!sku) errors.push({ row: rowNumber, field: 'sku', message: 'SKU is required' });
      if (!name) errors.push({ row: rowNumber, field: 'name', message: 'Product name is required' });
      if (!Number.isFinite(price) || price < 0 || (hasPriceCents && !Number.isInteger(price))) errors.push({ row: rowNumber, field: 'price', message: 'Price must be non-negative; priceCents must be an integer in paise' });
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) errors.push({ row: rowNumber, field: 'ratePercent', message: 'GST rate must be between 0 and 100' });
      if (!Number.isInteger(cost) || cost < 0) errors.push({ row: rowNumber, field: 'costCents', message: 'costCents must be a non-negative integer in paise' });
      if (sku && seenSkus.has(sku)) errors.push({ row: rowNumber, field: 'sku', message: 'SKU is duplicated in the import' });
      if (barcode && seenBarcodes.has(barcode)) errors.push({ row: rowNumber, field: 'barcode', message: 'Barcode is duplicated in the import' });
      if (sku) seenSkus.add(sku);
      if (barcode) seenBarcodes.add(barcode);
    }
    if (seenSkus.size) {
      const existing = await this.prisma.productVariant.findMany({ where: { organizationId: context.organizationId, sku: { in: [...seenSkus] } }, select: { sku: true } });
      for (const item of existing) {
        const row = rows.findIndex((candidate) => typeof candidate.sku === 'string' && candidate.sku.trim().toUpperCase() === item.sku) + 2;
        errors.push({ row, field: 'sku', message: `SKU already exists: ${item.sku}` });
      }
    }
    if (seenBarcodes.size) {
      const existing = await this.prisma.barcode.findMany({ where: { organizationId: context.organizationId, code: { in: [...seenBarcodes] } }, select: { code: true } });
      for (const item of existing) {
        const row = rows.findIndex((candidate) => candidate.barcode === item.code) + 2;
        errors.push({ row, field: 'barcode', message: `Barcode already exists: ${item.code}` });
      }
    }
    return { rowCount: rows.length, validRows: Math.max(0, rows.length - new Set(errors.filter((error) => error.row > 0).map((error) => error.row)).size), errors };
  }

  async commitCatalogImport(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const preview = await this.previewCatalogImport(context, input);
    if (preview.errors.length) throw new BadRequestException({ message: 'Import contains validation errors', errors: preview.errors });
    const rows = this.importRows(input.rows);
    await this.prisma.$transaction(async (tx) => {
      const products = new Map<string, { id: string }>();
      const taxGroups = new Map<number, { id: string }>();
      for (const row of rows) {
        const sku = String(row.sku).trim().toUpperCase();
        const name = String(row.name).trim();
        const productName = optionalString(row.productName) || name;
        const categoryName = optionalString(row.category);
        const brand = optionalString(row.brand) || '';
        const rate = Number(row.ratePercent ?? row.gst ?? 0);
        const amountCents = row.priceCents !== undefined ? money(row.priceCents, 'priceCents') : Math.round(Number(row.price) * 100);
        const category = categoryName ? await tx.category.findFirst({ where: { organizationId: context.organizationId, name: categoryName } }) : null;
        const productKey = `${productName}\u0000${category?.id ?? ''}\u0000${brand}`;
        let product = products.get(productKey);
        if (!product) {
          product = await tx.product.create({ data: { organizationId: context.organizationId, categoryId: category?.id ?? null, name: productName, brand }, select: { id: true } });
          products.set(productKey, product);
        }
        const rateBps = Math.round(rate * 100);
        let taxGroup = taxGroups.get(rateBps);
        if (!taxGroup) {
          taxGroup = await tx.taxGroup.upsert({ where: { organizationId_code: { organizationId: context.organizationId, code: `GST_${rate}` } }, create: { organizationId: context.organizationId, code: `GST_${rate}`, name: `GST ${rate}%`, rateBps }, update: {}, select: { id: true } });
          taxGroups.set(rateBps, taxGroup);
        }
        const costCents = row.costCents !== undefined ? money(row.costCents, 'costCents') : 0;
        const variant = await tx.productVariant.create({ data: { organizationId: context.organizationId, productId: product.id, sku, name, costCents, taxGroupId: taxGroup.id } });
        const barcode = optionalString(row.barcode);
        if (barcode) await tx.barcode.create({ data: { organizationId: context.organizationId, variantId: variant.id, code: barcode } });
        await tx.variantPrice.create({ data: { organizationId: context.organizationId, variantId: variant.id, amountCents, currency: 'INR', includesTax: row.includesTax === true } });
      }
      await this.audit.record(context, 'catalog.imported', 'Product', null, { rowCount: rows.length }, tx);
    });
    return { imported: rows.length };
  }

  async getOnboarding(context: UserContext) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const row = await this.prisma.organizationSettings.findUnique({ where: { organizationId: context.organizationId } });
    const settings = (row?.settings ?? {}) as JsonObject;
    return { onboarding: (settings.onboarding ?? { currentStep: 0, completedSteps: [], complete: false }) as JsonObject };
  }

  async updateOnboarding(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const current = (await this.getOnboarding(context)).onboarding;
    const existingStep = typeof current.currentStep === 'number' ? current.currentStep : 0;
    const currentStep = input.currentStep === undefined ? existingStep : Number(input.currentStep);
    if (!Number.isInteger(currentStep) || currentStep < 0 || currentStep > 7) throw new BadRequestException('currentStep must be between 0 and 7');
    const completedSteps = Array.isArray(input.completedSteps) ? input.completedSteps.filter((step): step is number => Number.isInteger(step) && step >= 0 && step <= 7) : (Array.isArray(current.completedSteps) ? current.completedSteps : []);
    const oldData = current.data && typeof current.data === 'object' && !Array.isArray(current.data) ? current.data as JsonObject : {};
    const patchData = input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data as JsonObject : {};
    const onboarding = { ...current, data: { ...oldData, ...patchData }, currentStep, completedSteps: [...new Set([...completedSteps, currentStep])] } as JsonObject;
    await this.prisma.organizationSettings.upsert({ where: { organizationId: context.organizationId }, create: { organizationId: context.organizationId, settings: { onboarding } as Prisma.InputJsonObject }, update: { settings: { ...(await this.getSettings(context)).settings, onboarding } as Prisma.InputJsonObject } });
    await this.audit.record(context, 'onboarding.progressed', 'OrganizationSettings', context.organizationId, { currentStep }, undefined);
    return { onboarding };
  }

  async saveOnboardingStores(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    if (!Array.isArray(input.stores) || input.stores.length < 1 || input.stores.length > 50) {
      throw new BadRequestException('Add between 1 and 50 stores');
    }
    const drafts = input.stores.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException(`Store ${index + 1} is invalid`);
      const value = entry as JsonObject;
      const id = optionalString(value.id) ? uuid(value.id, `stores[${index}].id`) : undefined;
      const code = requiredString(value.code, `stores[${index}].code`).toUpperCase();
      const name = requiredString(value.name, `stores[${index}].name`);
      const address = optionalString(value.address) ?? '';
      const timezone = optionalString(value.timezone) || 'Asia/Kolkata';
      const closeHour = value.closeHour === undefined || value.closeHour === null || value.closeHour === '' ? null : Number(value.closeHour);
      if (closeHour !== null && (!Number.isInteger(closeHour) || closeHour < 0 || closeHour > 23)) throw new BadRequestException(`Store ${index + 1} close hour must be from 0 to 23`);
      const registerCode = requiredString(value.registerCode, `stores[${index}].registerCode`).toUpperCase();
      const registerName = requiredString(value.registerName, `stores[${index}].registerName`);
      return { id, code, name, address, timezone, closeHour, registerCode, registerName };
    });
    if (new Set(drafts.map((store) => store.code)).size !== drafts.length) throw new BadRequestException('Store codes must be unique');
    if (new Set(drafts.flatMap((store) => store.id ? [store.id] : [])).size !== drafts.filter((store) => store.id).length) throw new BadRequestException('A store can only appear once in onboarding');
    if (drafts.some((store) => store.code.length > 32 || store.registerCode.length > 32)) throw new BadRequestException('Store and register codes must be 32 characters or fewer');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${context.organizationId}::uuid FOR UPDATE`;
        const organization = await tx.organization.findUnique({ where: { id: context.organizationId }, select: { status: true } });
        if (!organization || organization.status !== 'ACTIVE') throw new BadRequestException('Organisation is not active');
        const entitlement = await tx.organizationEntitlement.findUnique({ where: { organizationId: context.organizationId } });
        const currentActive = await tx.store.count({ where: { organizationId: context.organizationId, status: 'ACTIVE' } });
        const existing = await Promise.all(drafts.map((draft) => draft.id
          ? tx.store.findFirst({ where: { id: draft.id, organizationId: context.organizationId } })
          : tx.store.findUnique({ where: { organizationId_code: { organizationId: context.organizationId, code: draft.code } } })));
        if (existing.some((store, index) => drafts[index].id && !store)) throw new NotFoundException('Store not found');
        const slotsNeeded = existing.filter((store) => !store || store.status !== 'ACTIVE').length;
        if (!entitlement || currentActive + slotsNeeded > entitlement.maxStores) {
          throw new ConflictException(`Store limit reached (${entitlement?.maxStores ?? 0})`);
        }

        const saved = [];
        for (let index = 0; index < drafts.length; index += 1) {
          const draft = drafts[index];
          const currentStore = existing[index];
          const store = currentStore
            ? await tx.store.update({ where: { id: currentStore.id }, data: { code: draft.code, name: draft.name, address: draft.address, timezone: draft.timezone, closeHour: draft.closeHour, status: 'ACTIVE' } })
            : await tx.store.create({ data: { organizationId: context.organizationId, code: draft.code, name: draft.name, address: draft.address, timezone: draft.timezone, closeHour: draft.closeHour } });
          await tx.stockLocation.upsert({
            where: { organizationId_code: { organizationId: context.organizationId, code: `${draft.code}-STOCKROOM` } },
            create: { organizationId: context.organizationId, storeId: store.id, code: `${draft.code}-STOCKROOM`, name: `${draft.name} Stockroom` },
            update: { storeId: store.id, name: `${draft.name} Stockroom`, status: 'ACTIVE' },
          });
          const register = await tx.register.upsert({
            where: { storeId_code: { storeId: store.id, code: draft.registerCode } },
            create: { organizationId: context.organizationId, storeId: store.id, code: draft.registerCode, name: draft.registerName },
            update: { name: draft.registerName, status: 'ACTIVE' },
          });
          saved.push({ ...store, register: { id: register.id, code: register.code, name: register.name } });
          await this.audit.record(context, currentStore ? 'store.updated' : 'store.created', 'Store', store.id, { source: 'onboarding', code: store.code, registerId: register.id }, tx);
        }
        return { stores: saved };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A store or register code is already in use');
      throw error;
    }
  }

  async saveOnboardingManagers(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    if (!Array.isArray(input.managers) || input.managers.length < 1 || input.managers.length > 100) {
      throw new BadRequestException('Assign a manager to every store');
    }
    const managers = input.managers.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException(`Manager ${index + 1} is invalid`);
      const value = entry as JsonObject;
      const password = typeof value.password === 'string' && value.password.length ? value.password : undefined;
      if (password && password.length < 12) throw new BadRequestException(`Manager ${index + 1} password must contain at least 12 characters`);
      return {
        storeId: uuid(value.storeId, `managers[${index}].storeId`),
        firstName: requiredString(value.firstName, `managers[${index}].firstName`),
        lastName: optionalString(value.lastName) ?? '',
        email: this.email(value.email),
        password,
      };
    });
    if (new Set(managers.map((manager) => manager.storeId)).size !== managers.length) throw new BadRequestException('Assign one primary manager per store');

    return this.prisma.$transaction(async (tx) => {
      const storeIds = [...new Set(managers.map((manager) => manager.storeId))];
      const stores = await tx.store.findMany({ where: { organizationId: context.organizationId, id: { in: storeIds }, status: 'ACTIVE' }, select: { id: true, name: true } });
      if (stores.length !== storeIds.length) throw new NotFoundException('Store not found');
      const managerRole = await tx.role.findUnique({ where: { organizationId_name: { organizationId: context.organizationId, name: 'Store Manager' } }, select: { id: true } });
      if (!managerRole) throw new ConflictException('Store Manager role is not configured');
      const results = [];
      for (const manager of managers) {
        let user = await tx.user.findUnique({ where: { organizationId_email: { organizationId: context.organizationId, email: manager.email } } });
        if (!user) {
          if (!manager.password) throw new BadRequestException(`Enter an initial password for ${manager.email}`);
          user = await tx.user.create({
            data: { organizationId: context.organizationId, email: manager.email, firstName: manager.firstName, lastName: manager.lastName, passwordHash: this.auth.hashPassword(manager.password), defaultStoreId: manager.storeId },
          });
        } else {
          if (user.status !== 'ACTIVE') throw new ConflictException(`${manager.email} is not an active account`);
          const organizationRole = await tx.userRole.findFirst({ where: { userId: user.id, scopeType: 'ORGANIZATION' }, select: { id: true } });
          if (organizationRole) throw new ConflictException(`${manager.email} already has organisation-wide access; use a store-only account for this assignment`);
          user = await tx.user.update({ where: { id: user.id }, data: { firstName: manager.firstName, lastName: manager.lastName, ...(user.defaultStoreId ? {} : { defaultStoreId: manager.storeId }) } });
        }
        if (user.defaultStoreId === manager.storeId) await tx.userStore.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
        const existingAssignment = await tx.userRole.findFirst({ where: { userId: user.id, roleId: managerRole.id, scopeType: 'STORE', storeId: manager.storeId }, select: { id: true } });
        if (!existingAssignment) await tx.userRole.create({ data: { organizationId: context.organizationId, userId: user.id, roleId: managerRole.id, scopeType: 'STORE', storeId: manager.storeId } });
        await tx.userStore.upsert({ where: { userId_storeId: { userId: user.id, storeId: manager.storeId } }, create: { userId: user.id, storeId: manager.storeId, isDefault: user.defaultStoreId === manager.storeId }, update: { isDefault: user.defaultStoreId === manager.storeId } });
        results.push({ userId: user.id, storeId: manager.storeId, firstName: user.firstName, lastName: user.lastName, email: user.email });
        await this.audit.record(context, 'user.store-manager-assigned', 'User', user.id, { storeId: manager.storeId }, tx);
      }
      return { managers: results };
    });
  }

  async finishOnboarding(context: UserContext) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const stores = await this.prisma.store.findMany({
      where: { organizationId: context.organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        registers: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 },
        userRoles: { where: { scopeType: 'STORE', role: { name: 'Store Manager', status: 'ACTIVE' }, user: { status: 'ACTIVE' } }, select: { id: true }, take: 1 },
      },
    });
    if (stores.length === 0) throw new BadRequestException('Create at least one store before finishing setup');
    const missingRegister = stores.find((store) => store.registers.length === 0);
    if (missingRegister) throw new BadRequestException(`${missingRegister.name} needs an active register`);
    const missingManager = stores.find((store) => store.userRoles.length === 0);
    if (missingManager) throw new BadRequestException(`${missingManager.name} needs an assigned Store Manager`);
    const settings = (await this.getSettings(context)).settings;
    const onboarding = { ...((settings.onboarding ?? {}) as JsonObject), currentStep: 7, completedSteps: [0, 1, 2, 3, 4, 5, 6, 7], complete: true };
    const next = { ...settings, onboarding } as Prisma.InputJsonObject;
    await this.prisma.organizationSettings.upsert({ where: { organizationId: context.organizationId }, create: { organizationId: context.organizationId, settings: next }, update: { settings: next } });
    await this.audit.record(context, 'onboarding.completed', 'OrganizationSettings', context.organizationId, {}, undefined);
    return { onboarding };
  }

  private importRows(value: unknown): JsonObject[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 5000 || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new BadRequestException('rows must be an array of 1 to 5000 objects');
    return value as JsonObject[];
  }

  // ───────────── Helpers ─────────────

  private async getUserRecord(context: UserContext, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId: context.organizationId }, include: userInclude });
    if (!user) throw new NotFoundException('User not found');
    return this.userDto(user);
  }

  private async ensureUser(organizationId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private authorizationStoreAccess(context: UserContext, storeId: string) {
    if (!context.isOrganisationAdministrator && !context.storeIds.includes(storeId) && !context.grants.some((grant) => grant.scopeType === 'STORE' && grant.scopeId === storeId)) {
      throw new ForbiddenException('User does not have access to this store');
    }
  }

  private async ensureStore(organizationId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async getStore(context: UserContext, storeId: string) {
    const store = await this.ensureStore(context.organizationId, storeId);
    const registers = await this.prisma.register.findMany({ where: { storeId, organizationId: context.organizationId }, orderBy: { name: 'asc' } });
    const { organizationId: _organizationId, ...dto } = store;
    return { ...dto, registers: registers.map((register) => this.registerDto(register)) };
  }

  private hasOrganizationScope(context: UserContext, permissionCode: string): boolean {
    return this.authorization.hasPermission(context, permissionCode);
  }

  private requireOrganizationPermission(context: UserContext, permissionCode: string): void {
    if (!this.hasOrganizationScope(context, permissionCode)) throw new ForbiddenException(`Missing organisation-wide permission: ${permissionCode}`);
  }

  private async ensurePermissions(permissionCodes: string[]) {
    const known = new Set((await this.prisma.permission.findMany({ select: { code: true } })).map((permission) => permission.code));
    const unknown = permissionCodes.filter((permission) => !known.has(permission));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
  }

  /** Every referenced store and active role must belong to the caller's organisation. */
  private async validateAccess(organizationId: string, storeIds: string[], assignments: RoleAssignmentInput[]) {
    const allStoreIds = [...new Set([...storeIds, ...assignments.flatMap((a) => (a.storeId ? [a.storeId] : []))])];
    if (allStoreIds.length) {
      const found = await this.prisma.store.count({ where: { organizationId, id: { in: allStoreIds } } });
      if (found !== allStoreIds.length) throw new NotFoundException('Store not found');
    }
    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    if (roleIds.length) {
      const found = await this.prisma.role.findMany({ where: { organizationId, status: 'ACTIVE', id: { in: roleIds } }, select: { id: true } });
      const missing = roleIds.filter((id) => !found.some((role) => role.id === id));
      if (missing.length) throw new BadRequestException(`Role not found: ${missing[0]}`);
    }
  }

  private async writeAccess(tx: Tx, organizationId: string, userId: string, assignments: RoleAssignmentInput[], storeIds: string[]) {
    if (assignments.length) {
      await tx.userRole.createMany({
        data: assignments.map((a) => ({ organizationId, userId, roleId: a.roleId, scopeType: a.scopeType, storeId: a.scopeType === 'STORE' ? a.storeId : null })),
        skipDuplicates: true,
      });
    }
    if (storeIds.length) {
      await tx.userStore.createMany({
        data: [...new Set(storeIds)].map((storeId, index) => ({ userId, storeId, isDefault: index === 0 })),
      });
    }
  }

  private roleAssignments(input: JsonObject): RoleAssignmentInput[] {
    if (Array.isArray(input.roleAssignments)) {
      return input.roleAssignments.map((assignment) => {
        if (!assignment || typeof assignment !== 'object') throw new BadRequestException('Invalid role assignment');
        const value = assignment as JsonObject;
        const scopeType = value.scopeType === 'STORE' ? 'STORE' : 'ORGANIZATION';
        return {
          roleId: uuid(value.roleId, 'roleId'),
          scopeType,
          storeId: scopeType === 'STORE' ? uuid(value.scopeId ?? value.storeId, 'scopeId') : null,
        } as RoleAssignmentInput;
      });
    }
    return stringArray(input.roleIds).map((roleId) => ({ roleId: uuid(roleId, 'roleIds'), scopeType: 'ORGANIZATION' as const, storeId: null }));
  }

  private async holdsAdministratorRole(assignments: RoleAssignmentInput[]): Promise<boolean> {
    const roles = await this.prisma.role.findMany({
      where: { id: { in: assignments.filter((a) => a.scopeType === 'ORGANIZATION').map((a) => a.roleId) }, name: ORGANISATION_ADMINISTRATOR_ROLE },
      select: { id: true },
    });
    return roles.length > 0;
  }

  private async assertNotLastAdministrator(organizationId: string, userId: string) {
    const isAdministrator = await this.prisma.userRole.count({ where: { userId, role: { name: ORGANISATION_ADMINISTRATOR_ROLE } } });
    if (!isAdministrator) return;
    const administrators = await this.prisma.user.count({
      where: { organizationId, status: 'ACTIVE', roles: { some: { role: { name: ORGANISATION_ADMINISTRATOR_ROLE } } } },
    });
    if (administrators <= 1) throw new ConflictException('The last active Organisation Administrator cannot be disabled');
  }

  private productStatus(value: unknown): ProductStatus {
    if (value === undefined) return 'ACTIVE';
    const status = typeof value === 'string' ? value.toUpperCase() : '';
    if (!PRODUCT_STATUSES.includes(status)) throw new BadRequestException(`status must be one of: ${PRODUCT_STATUSES.join(', ')}`);
    return status as ProductStatus;
  }

  private email(value: unknown): string {
    if (typeof value !== 'string' || !/^\S+@\S+\.\S+$/.test(value.trim())) throw new BadRequestException('A valid email is required');
    return value.trim().toLowerCase();
  }

  // ───────────── DTO mapping ─────────────

  private userDto(user: UserWithAccess) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      defaultStoreId: user.defaultStoreId,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: user.roles.map((assignment) => ({
        id: assignment.role.id,
        name: assignment.role.name,
        scopeType: assignment.scopeType,
        scopeId: assignment.storeId,
      })),
      storeIds: user.stores.map((store) => store.storeId),
    };
  }

  private roleDto(role: Prisma.RoleGetPayload<{ include: { permissions: { select: { permissionCode: true; effect: true } } } }>) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      status: role.status,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      permissions: role.permissions.map((permission) => permission.permissionCode),
      permissionEffects: Object.fromEntries(role.permissions.map((permission) => [permission.permissionCode, permission.effect])),
    };
  }

  private permissionEffect(input: JsonObject, permissionCode: string): PermissionEffect {
    const effects = input.permissionEffects;
    const value = effects && typeof effects === 'object' && !Array.isArray(effects)
      ? (effects as JsonObject)[permissionCode]
      : undefined;
    if (value === 'REQUIRE_APPROVAL') return PermissionEffect.REQUIRE_APPROVAL;
    if (value === 'DENY') return PermissionEffect.DENY;
    return PermissionEffect.ALLOW;
  }

  private registerDto(register: { id: string; storeId: string; code: string; name: string; status: RecordStatus; createdAt: Date; updatedAt: Date }) {
    return {
      id: register.id,
      storeId: register.storeId,
      code: register.code,
      name: register.name,
      status: register.status,
      createdAt: register.createdAt,
      updatedAt: register.updatedAt,
    };
  }

  private taxGroupDto(group: { id: string; code: string; name: string; hsnCode: string; rateBps: number; includesTax: boolean; createdAt: Date; updatedAt: Date }) {
    return {
      id: group.id,
      code: group.code,
      name: group.name,
      hsnCode: group.hsnCode,
      rateBps: group.rateBps,
      ratePercent: group.rateBps / 100,
      includesTax: group.includesTax,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  private productDto(product: ProductWithVariants) {
    return {
      id: product.id,
      categoryId: product.categoryId,
      category: product.category,
      name: product.name,
      description: product.description,
      brand: product.brandRef?.name ?? product.brand,
      brandId: product.brandId,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        productId: variant.productId,
        sku: variant.sku,
        name: variant.name,
        costCents: variant.costCents,
        status: variant.status,
        uomId: variant.uomId,
        taxGroupId: variant.taxGroupId,
        uomCode: variant.uom?.code ?? null,
        taxCode: variant.taxGroup?.code ?? null,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
        barcodes: variant.barcodes.map((barcode) => barcode.code),
        prices: variant.prices.map((price) => ({
          id: price.id,
          storeId: price.storeId,
          amountCents: price.amountCents,
          currency: price.currency,
          includesTax: price.includesTax,
          effectiveFrom: price.effectiveFrom,
        })),
      })),
    };
  }
}

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
import { validateTaxNumber } from '@pos/shared/tax-id';
import { composeOmanAddress, isOmanCountry, normalizeOmanPhone, type OmanAddressDetails } from '@pos/shared/address-formats';
import { validateStoreHours, type StoreOperatingHours } from '@pos/shared/store-hours';
import { isCurrencyCode, minorFactor } from '@pos/shared/currency';
import { isMarketCode, MARKETS, taxRegimeFor } from '@pos/shared/markets';
import { cleanAttributeValues, cleanTypeConfig, readTypeConfig, type TypeConfig } from './product-types.js';
import { applyBillingPatch, BILLING_KEYS, DEFAULT_BILLING_SETTINGS } from '../common/billing-settings.js';
import { cleanFieldSet, cleanFieldValues, objectField } from '../common/field-config.js';
import { isUniqueViolation, Tx } from '../database/db.js';
import { PrismaService } from '../database/prisma.service.js';
import { PermissionEffect, Prisma, ProductStatus, RecordStatus, UserStatus } from '../generated/prisma/client.js';

type RoleAssignmentInput = { roleId: string; scopeType: 'ORGANIZATION' | 'STORE'; storeId: string | null };

const USER_STATUSES: readonly string[] = Object.values(UserStatus);
const RECORD_STATUSES: readonly string[] = Object.values(RecordStatus);
const PRODUCT_STATUSES: readonly string[] = Object.values(ProductStatus);

/** Used only when neither the request nor the organisation names a time zone. */
const DEFAULT_TIMEZONE = 'Asia/Muscat';

const SETTINGS_KEYS = ['defaultStoreId', 'inventoryPolicy', 'storeCloseHour', 'idleLockMinutes', 'onboarding', 'productFields'] as const;

const userInclude = {
  roles: { include: { role: { select: { id: true, name: true } } }, orderBy: { role: { name: 'asc' } } },
  stores: { select: { storeId: true } },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const productInclude = {
  productType: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  brandRef: { select: { id: true, name: true } },
  variants: {
    orderBy: { name: 'asc' },
    include: {
      uom: { select: { code: true } },
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
    const countryCode = input.countryCode === undefined ? undefined : oneOf(input.countryCode, MARKETS.map((market) => market.code), 'countryCode');
    const taxProfileStatus = input.taxProfileStatus === undefined ? undefined : oneOf(input.taxProfileStatus, ['NOT_REVIEWED', 'REGISTERED', 'NOT_REGISTERED', 'UNSURE', 'LEGACY'] as const, 'taxProfileStatus');
    const currentProfile = await this.prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { countryCode: true, gstin: true, taxProfileStatus: true, taxRegime: true } });
    const taxRegime = input.taxRegime === undefined ? undefined : oneOf(input.taxRegime, ['GST', 'VAT', 'TAX'] as const, 'taxRegime');
    if (countryCode && countryCode !== currentProfile.countryCode) {
      const sales = await this.prisma.sale.count({ where: { organizationId: context.organizationId } });
      if (sales) throw new ConflictException('Country cannot be changed after the first sale without migrating historical tax documents.');
    }
    if (taxProfileStatus === 'LEGACY' && currentProfile.taxProfileStatus !== 'LEGACY') throw new BadRequestException('LEGACY is reserved for organisations carried forward from earlier versions');
    const gstinInput = optionalString(input.gstin);
    let gstin: string | undefined;
    if (gstinInput !== undefined) {
      if (gstinInput) {
        const result = validateTaxNumber(countryCode ?? currentProfile.countryCode, gstinInput);
        if (!result.valid) throw new BadRequestException(result.error ?? 'Invalid tax number');
        gstin = result.normalized;
      } else gstin = '';
    }
    const effectiveGstin = gstinInput === undefined ? currentProfile.gstin : gstin;
    const effectiveCountry = countryCode ?? currentProfile.countryCode;
    if (effectiveGstin && !validateTaxNumber(effectiveCountry, effectiveGstin).valid) throw new BadRequestException('Enter a tax number for the selected country or clear the previous one.');
    if ((taxProfileStatus ?? currentProfile.taxProfileStatus) === 'REGISTERED' && !effectiveGstin && (effectiveCountry === 'IN' || effectiveCountry === 'OM')) throw new BadRequestException('A tax number is required when registration is selected');
    const organization = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id: context.organizationId },
        data: {
          ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
          ...(optionalString(input.legalName) !== undefined ? { legalName: optionalString(input.legalName) } : {}),
          ...(optionalString(input.tradeName) !== undefined ? { tradeName: optionalString(input.tradeName) } : {}),
          ...(optionalString(input.address) !== undefined ? { address: optionalString(input.address) } : {}),
          ...(gstin !== undefined ? { gstin } : {}),
          ...(optionalString(input.businessType) !== undefined ? { businessType: optionalString(input.businessType)?.toUpperCase() } : {}),
          ...(optionalString(input.timezone) !== undefined ? { timezone: optionalString(input.timezone) } : {}),
          ...(countryCode !== undefined ? { countryCode } : {}),
          ...(taxRegime !== undefined || countryCode !== undefined ? { taxRegime: taxRegime ?? taxRegimeFor(countryCode) } : {}),
          ...(taxProfileStatus !== undefined ? { taxProfileStatus } : {}),
        },
      });
      await this.audit.record(context, 'organization.updated', 'Organization', updated.id, { fields: Object.keys(input) }, tx);
      return updated;
    });
    return organization;
  }

  async getSettings(context: UserContext, includeCurrencyLock = false) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const [row, organization, sales] = await Promise.all([
      this.prisma.organizationSettings.findUnique({ where: { organizationId: context.organizationId } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { currency: true } }),
      includeCurrencyLock ? this.prisma.sale.count({ where: { organizationId: context.organizationId } }) : Promise.resolve(0),
    ]);
    const settings = { ...((row?.settings ?? {}) as JsonObject) };
    for (const key of BILLING_KEYS) delete settings[key];
    delete settings.checkoutFields;
    delete settings.requireBillHandler;
    if (settings.productFields !== undefined) settings.productFields = cleanFieldSet(settings.productFields) as unknown as JsonObject;
    return { settings, currency: organization.currency, currencyLocked: sales > 0 };
  }

  /** The organisation's canonical currency code. */
  private async orgCurrency(organizationId: string): Promise<string> {
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { currency: true } });
    return organization.currency;
  }

  async updateSettings(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    if (BILLING_KEYS.some((key) => key in input) || 'checkoutFields' in input) {
      throw new BadRequestException('Billing and checkout settings belong to each store. Open that store’s Billing & Checkout settings.');
    }
    const next: JsonObject = { ...(await this.getSettings(context)).settings };
    delete next.currency;
    delete next.checkoutFields;
    delete next.requireBillHandler;
    for (const key of BILLING_KEYS) delete next[key];
    const previousCurrency = await this.orgCurrency(context.organizationId);
    let nextCurrency = previousCurrency;
    for (const key of SETTINGS_KEYS) {
      if (key in input) next[key] = input[key];
    }
    if ('productFields' in input) next.productFields = cleanFieldSet(input.productFields);
    if ('currency' in input) {
      if (!isCurrencyCode(input.currency)) throw new BadRequestException('Choose one of the listed currencies');
      if (input.currency !== previousCurrency) {
        // Amounts are stored in the currency's smallest unit with no conversion, so changing it under existing sales would silently change what they mean.
        const sales = await this.prisma.sale.count({ where: { organizationId: context.organizationId } });
        if (sales > 0) throw new ConflictException({ code: 'CURRENCY_LOCKED', message: 'The currency cannot be changed after the first sale, because past amounts would change meaning.' });
      }
      nextCurrency = input.currency;
    }
    if ('idleLockMinutes' in input) {
      const minutes = Number(input.idleLockMinutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new BadRequestException('idleLockMinutes must be a whole number from 1 to 240');
      next.idleLockMinutes = minutes;
    }
    if (typeof next.defaultStoreId === 'string') {
      await this.ensureStore(context.organizationId, uuid(next.defaultStoreId, 'defaultStoreId'));
    }
    await this.prisma.$transaction(async (tx) => {
      if (nextCurrency !== previousCurrency) await tx.organization.update({ where: { id: context.organizationId }, data: { currency: nextCurrency } });
      await tx.organizationSettings.upsert({
        where: { organizationId: context.organizationId },
        create: { organizationId: context.organizationId, settings: next as Prisma.InputJsonObject },
        update: { settings: next as Prisma.InputJsonObject },
      });
      await this.audit.record(context, 'organization.settings.updated', 'OrganizationSettings', context.organizationId, { keys: Object.keys(input) }, tx);
    });
    return { settings: next, currency: nextCurrency };
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

  async listStoreAssignableRoles(context: UserContext, storeId: string) {
    const id = uuid(storeId, 'storeId');
    this.authorizationStoreAccess(context, id);
    this.authorization.assertPermissions(context, ['store.staff.manage'], id);
    const roles = await this.prisma.role.findMany({
      where: { organizationId: context.organizationId, status: 'ACTIVE', storeAssignable: true },
      include: { permissions: { select: { permissionCode: true, effect: true }, orderBy: { permissionCode: 'asc' } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    // A manager can only assign a role whose allowed permissions are already within their own store-level authority.
    return roles.filter((role) => role.permissions.every((permission) =>
      permission.effect === 'DENY' || this.authorization.hasPermission(context, permission.permissionCode, id),
    )).map((role) => ({ id: role.id, name: role.name, description: role.description, isSystem: role.isSystem }));
  }

  async assignStoreRole(context: UserContext, storeId: string, userId: string, input: JsonObject) {
    const id = uuid(storeId, 'storeId');
    const targetId = uuid(userId, 'userId');
    this.authorizationStoreAccess(context, id);
    this.authorization.assertPermissions(context, ['store.staff.manage'], id);
    await this.ensureStore(context.organizationId, id);
    const user = await this.prisma.user.findFirst({
      where: {
        id: targetId,
        organizationId: context.organizationId,
        OR: [{ stores: { some: { storeId: id } } }, { roles: { some: { scopeType: 'STORE', storeId: id } } }],
      },
      select: { id: true, status: true },
    });
    if (!user) throw new NotFoundException('Staff member not found in this store');
    if (user.status !== 'ACTIVE') throw new BadRequestException('Only active staff can be assigned a store role');

    const roleId = input.roleId === null || input.roleId === '' ? null : uuid(input.roleId, 'roleId');
    const role = roleId ? await this.prisma.role.findFirst({
      where: { id: roleId, organizationId: context.organizationId, status: 'ACTIVE', storeAssignable: true },
      include: { permissions: { select: { permissionCode: true, effect: true } } },
    }) : null;
    if (roleId && !role) throw new BadRequestException('Choose a role approved for store-manager assignment');
    if (role && !role.permissions.every((permission) => permission.effect === 'DENY' || this.authorization.hasPermission(context, permission.permissionCode, id))) {
      throw new ForbiddenException('This role grants permissions beyond your authority in this store');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { organizationId: context.organizationId, userId: targetId, scopeType: 'STORE', storeId: id } });
      if (role) await tx.userRole.create({ data: { organizationId: context.organizationId, userId: targetId, roleId: role.id, scopeType: 'STORE', storeId: id } });
      await tx.userStore.upsert({
        where: { userId_storeId: { userId: targetId, storeId: id } },
        create: { userId: targetId, storeId: id, isDefault: false },
        update: {},
      });
      await this.audit.record(context, 'store.staff.role.updated', 'User', targetId, { storeId: id, roleId: role?.id ?? null, roleName: role?.name ?? null }, tx);
    });
    return { userId: targetId, storeId: id, role: role ? { id: role.id, name: role.name } : null };
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
      if (nextStatus && nextStatus !== 'ACTIVE') {
        await tx.session.deleteMany({ where: { userId } });
      }
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
            storeAssignable: input.storeAssignable === true,
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
    const storeAssignable = input.storeAssignable === undefined ? undefined : input.storeAssignable === true;
    if (input.storeAssignable !== undefined && typeof input.storeAssignable !== 'boolean') throw new BadRequestException('storeAssignable must be true or false');
    if (storeAssignable === false && (await this.prisma.userRole.count({ where: { roleId, scopeType: 'STORE' } })) > 0) {
      throw new ConflictException('Reassign store users before removing this role from store-manager assignment');
    }
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
            ...(storeAssignable !== undefined ? { storeAssignable } : {}),
          },
        });
        if (permissions) {
          await tx.rolePermission.deleteMany({ where: { roleId } });
          await tx.rolePermission.createMany({ data: [...new Set(permissions)].map((permissionCode) => ({ roleId, permissionCode, effect: this.permissionEffect(input, permissionCode) })) });
        }
        await this.audit.record(context, 'role.updated', 'Role', roleId, { name: input.name, status, storeAssignable, permissionsChanged: Boolean(permissions) }, tx);
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
    const city = optionalString(input.city) ?? '';
    const region = optionalString(input.region) ?? '';
    const postalCode = optionalString(input.postalCode) ?? '';
    const phone = optionalString(input.phone) ?? '';
    const profile = await this.prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { countryCode: true, timezone: true } });
    const timezone = optionalString(input.timezone) || profile.timezone || DEFAULT_TIMEZONE;
    const closeHour = input.closeHour === undefined || input.closeHour === null || input.closeHour === '' ? null : Number(input.closeHour);
    if (closeHour !== null && (!Number.isInteger(closeHour) || closeHour < 0 || closeHour > 23)) throw new BadRequestException('closeHour must be an integer from 0 to 23');
    const structured = this.addressFromInput(input);
    // The UI requires an address, while omitted address keeps older API clients compatible.
    if (input.address !== undefined && !(structured?.address ?? address).trim()) throw new BadRequestException('address is required');
    const operatingHours = input.operatingHours === undefined ? null : this.parseOperatingHours(input.operatingHours);
    const storePhone = this.phoneFromInput(profile.countryCode, phone);

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
        const store = await tx.store.create({ data: { organizationId: context.organizationId, code, name, address: structured?.address ?? address, city: structured?.city ?? city, region: structured?.region ?? region, postalCode: structured?.postalCode ?? postalCode, phone: storePhone, timezone, closeHour, ...(operatingHours ? { operatingHours: operatingHours as Prisma.InputJsonValue } : {}), addressDetails: (structured?.addressDetails ?? {}) as Prisma.InputJsonObject, billingSettings: DEFAULT_BILLING_SETTINGS as Prisma.InputJsonObject } });
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

  /** Empty clears the store's own GSTIN (the organisation's is used); anything else must be a valid GSTIN. */
  private async storeTaxNumber(organizationId: string, input: JsonObject): Promise<{ taxNumber: string } | Record<string, never>> {
    if (input.taxNumber === undefined) return {};
    const raw = optionalString(input.taxNumber) ?? '';
    if (raw === '') return { taxNumber: '' };
    const profile = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { countryCode: true } });
    const check = validateTaxNumber(profile.countryCode, raw);
    if (!check.valid) throw new BadRequestException(check.error ?? 'Invalid tax number');
    return { taxNumber: check.normalized };
  }

  /** The new UI stores one compact address. Structured Oman data is only read to keep legacy records editable. */
  private addressFromInput(input: JsonObject): { address: string; city?: string; region?: string; postalCode?: string; addressDetails: JsonObject } | undefined {
    const direct = optionalString(input.address);
    if (direct !== undefined) return { address: direct, addressDetails: {} };
    if (!input.addressDetails || typeof input.addressDetails !== 'object' || Array.isArray(input.addressDetails)) return undefined;
    const legacy = input.addressDetails as OmanAddressDetails;
    const composed = composeOmanAddress(legacy);
    return { ...composed, addressDetails: input.addressDetails as JsonObject };
  }

  private parseOperatingHours(input: unknown): StoreOperatingHours | null {
    if (input === null) return null;
    const parsed = validateStoreHours(input);
    if (!parsed.valid) throw new BadRequestException(parsed.error ?? 'Enter valid operating hours');
    return parsed.value;
  }

  /** Oman phone numbers are stored as +968XXXXXXXX; other countries keep what was entered. */
  private phoneFromInput(countryCode: string, phone: string): string {
    if (!isOmanCountry(countryCode)) return phone;
    const result = normalizeOmanPhone(phone);
    if (!result.valid) throw new BadRequestException(result.error ?? 'Enter a valid Omani phone number');
    return result.phone;
  }

  async updateStore(context: UserContext, storeId: string, input: JsonObject) {
    // Store lifecycle and identity are managed from the organisation's store administration area.
    this.requireOrganizationPermission(context, 'stores.manage');
    await this.ensureStore(context.organizationId, storeId);
    const status = typeof input.status === 'string' ? input.status.toUpperCase() : undefined;
    if (status && !RECORD_STATUSES.includes(status)) throw new BadRequestException('Invalid store status');
    const closeHour = input.closeHour === undefined || input.closeHour === null || input.closeHour === '' ? undefined : Number(input.closeHour);
    if (closeHour !== undefined && (!Number.isInteger(closeHour) || closeHour < 0 || closeHour > 23)) throw new BadRequestException('closeHour must be an integer from 0 to 23');
    const taxPatch = await this.storeTaxNumber(context.organizationId, input);
    const country = (await this.prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { countryCode: true } })).countryCode;
    const structured = this.addressFromInput(input);
    if (input.address !== undefined && !optionalString(input.address)) throw new BadRequestException('address is required');
    const operatingHours = input.operatingHours === undefined ? undefined : this.parseOperatingHours(input.operatingHours);
    await this.prisma.$transaction(async (tx) => {
      await tx.store.update({
        where: { id: storeId },
        data: {
          ...taxPatch,
          ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
          ...(structured ? { address: structured.address, ...(structured.city !== undefined ? { city: structured.city } : {}), ...(structured.region !== undefined ? { region: structured.region } : {}), ...(structured.postalCode !== undefined ? { postalCode: structured.postalCode } : {}), addressDetails: structured.addressDetails as Prisma.InputJsonObject } : {
            ...(optionalString(input.address) !== undefined ? { address: optionalString(input.address) } : {}),
            ...(optionalString(input.city) !== undefined ? { city: optionalString(input.city) ?? '' } : {}),
            ...(optionalString(input.region) !== undefined ? { region: optionalString(input.region) ?? '' } : {}),
            ...(optionalString(input.postalCode) !== undefined ? { postalCode: optionalString(input.postalCode) ?? '' } : {}),
          }),
          ...(optionalString(input.phone) !== undefined ? { phone: this.phoneFromInput(country, optionalString(input.phone) ?? '') } : {}),
          ...(optionalString(input.timezone) ? { timezone: optionalString(input.timezone) } : {}),
          ...(operatingHours !== undefined ? { operatingHours: operatingHours === null ? Prisma.JsonNull : operatingHours as Prisma.InputJsonValue } : {}),
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
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { countryCode: true, taxRegime: true } });
    const orgSettings = (await this.getOrganizationSettingsObject(context.organizationId));
    const fieldSettings = objectField(store.fieldSettings);
    const organisationProductFields = cleanFieldSet(orgSettings.productFields);
    const storeCheckoutFields = cleanFieldSet(fieldSettings.checkoutFields, 'CHECKOUT');
    const billing = { ...DEFAULT_BILLING_SETTINGS, ...objectField(store.billingSettings) };
    const operatingHours = store.operatingHours ? objectField(store.operatingHours) : {};
    return { id: store.id, code: store.code, name: store.name, address: store.address, city: store.city, region: store.region, postalCode: store.postalCode, addressDetails: objectField(store.addressDetails), countryCode: organization.countryCode, taxRegime: organization.taxRegime, phone: store.phone, timezone: store.timezone, operatingHours: Object.keys(operatingHours).length ? operatingHours : null, closeHour: store.closeHour, taxNumber: store.taxNumber,
      organisationProductFields, effectiveProductFields: organisationProductFields.fields, effectiveProductCoreFields: organisationProductFields.coreFields,
      checkoutFieldSettings: storeCheckoutFields, effectiveCheckoutFields: storeCheckoutFields.fields,
      requireBillHandler: billing.requireBillHandler === true, ...(await this.storeBilling(context.organizationId, billing)) };
  }

  /** This store's complete billing settings and the organisation's accounting currency. */
  private async storeBilling(organizationId: string, own: unknown) {
    const [organization, sales] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { currency: true } }),
      this.prisma.sale.count({ where: { organizationId } }),
    ]);
    return {
      currency: organization.currency,
      currencyLocked: sales > 0,
      billing: { ...DEFAULT_BILLING_SETTINGS, ...((own && typeof own === 'object' && !Array.isArray(own) ? own : {}) as JsonObject) },
    };
  }

  async updateStoreSettings(context: UserContext, storeId: string, input: JsonObject) {
    const id = uuid(storeId, 'storeId');
    this.authorizationStoreAccess(context, id);
    this.authorization.assertPermissions(context, ['store.settings.manage'], id);
    if ('productFields' in input) throw new BadRequestException('Product fields are owned by the organisation and cannot be changed by a store.');
    const closeHour = !('closeHour' in input) ? undefined : input.closeHour === null || input.closeHour === '' ? null : Number(input.closeHour);
    if (closeHour !== undefined && closeHour !== null && (!Number.isInteger(closeHour) || closeHour < 0 || closeHour > 23)) throw new BadRequestException('Close hour must be an integer from 0 to 23');
    const taxPatch = await this.storeTaxNumber(context.organizationId, input);
    const country = (await this.prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId }, select: { countryCode: true } })).countryCode;
    const structured = this.addressFromInput(input);
    if (input.address !== undefined && !optionalString(input.address)) throw new BadRequestException('address is required');
    const operatingHours = input.operatingHours === undefined ? undefined : this.parseOperatingHours(input.operatingHours);
    if (input.billing !== undefined && (typeof input.billing !== 'object' || input.billing === null || Array.isArray(input.billing))) throw new BadRequestException('billing must be an object');
    const billingPatch = input.billing === undefined ? undefined : applyBillingPatch({ ...DEFAULT_BILLING_SETTINGS, ...objectField((await this.ensureStore(context.organizationId, id)).billingSettings) }, input.billing as JsonObject);
    const store = await this.ensureStore(context.organizationId, id);
    let fieldSettings: Prisma.InputJsonObject | undefined;
    if (input.checkoutFields !== undefined) {
      const currentFields = objectField(store.fieldSettings);
      const nextSettings: JsonObject = { ...currentFields };
      nextSettings.checkoutFields = cleanFieldSet(input.checkoutFields, 'CHECKOUT') as unknown as JsonObject;
      fieldSettings = nextSettings as Prisma.InputJsonObject;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.store.update({ where: { id }, data: {
        ...taxPatch,
        ...(billingPatch ? { billingSettings: billingPatch as Prisma.InputJsonObject } : {}),
        ...(fieldSettings ? { fieldSettings } : {}),
        ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
        ...(structured ? { address: structured.address, ...(structured.city !== undefined ? { city: structured.city } : {}), ...(structured.region !== undefined ? { region: structured.region } : {}), ...(structured.postalCode !== undefined ? { postalCode: structured.postalCode } : {}), addressDetails: structured.addressDetails as Prisma.InputJsonObject } : {
          ...(optionalString(input.address) !== undefined ? { address: optionalString(input.address) ?? '' } : {}),
          ...(optionalString(input.city) !== undefined ? { city: optionalString(input.city) ?? '' } : {}),
          ...(optionalString(input.region) !== undefined ? { region: optionalString(input.region) ?? '' } : {}),
          ...(optionalString(input.postalCode) !== undefined ? { postalCode: optionalString(input.postalCode) ?? '' } : {}),
        }),
        ...(optionalString(input.phone) !== undefined ? { phone: this.phoneFromInput(country, optionalString(input.phone) ?? '') } : {}),
        ...(optionalString(input.timezone) ? { timezone: optionalString(input.timezone) } : {}),
        ...(operatingHours !== undefined ? { operatingHours: operatingHours === null ? Prisma.JsonNull : operatingHours as Prisma.InputJsonValue } : {}),
        ...(closeHour !== undefined ? { closeHour } : {}),
      } });
      await this.audit.record(context, 'store.settings.updated', 'Store', id, { fields: Object.keys(input) }, tx);
    });
    return this.getStoreSettings(context, id);
  }

  private async getOrganizationSettingsObject(organizationId: string): Promise<JsonObject> {
    const row = await this.prisma.organizationSettings.findUnique({ where: { organizationId }, select: { settings: true } });
    return (row?.settings ?? {}) as JsonObject;
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
    // Register setup is an organisation-side provisioning action; opening/closing a register remains store-scoped.
    await this.ensureStore(context.organizationId, storeId);
    this.authorization.assertStoreAccess(context, storeId);
    this.requireStoreOrOrganizationPermission(context, 'registers.manage', storeId);
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
    this.authorization.assertStoreAccess(context, register.storeId);
    this.requireStoreOrOrganizationPermission(context, 'registers.manage', register.storeId);
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

  async getCatalogFieldConfig(context: UserContext) {
    this.requireOrganizationPermission(context, 'catalog.view');
    const settings = await this.getOrganizationSettingsObject(context.organizationId);
    return cleanFieldSet(settings.productFields);
  }

  async listCategories(context: UserContext) {
    this.requireOrganizationPermission(context, 'catalog.view');
    const categories = await this.prisma.category.findMany({ where: { organizationId: context.organizationId }, include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } });
    return categories.map(({ organizationId: _organizationId, _count, ...category }) => ({ ...category, products: _count.products }));
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

  async updateCategory(context: UserContext, categoryId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const id = uuid(categoryId, 'categoryId');
    const categories = await this.prisma.category.findMany({ where: { organizationId: context.organizationId }, select: { id: true, parentId: true } });
    const current = categories.find((category) => category.id === id);
    if (!current) throw new NotFoundException('Category not found');
    const parentId = input.parentId === undefined ? current.parentId : input.parentId === null || input.parentId === '' ? null : uuid(input.parentId, 'parentId');
    const byId = new Map(categories.map((category) => [category.id, category]));
    const visited = new Set<string>([id]);
    for (let ancestor = parentId; ancestor; ancestor = byId.get(ancestor)?.parentId ?? null) {
      if (!byId.has(ancestor)) throw new BadRequestException('Parent category not found');
      if (visited.has(ancestor)) throw new BadRequestException('A category cannot be nested under itself or a descendant');
      visited.add(ancestor);
    }
    const name = input.name === undefined ? undefined : requiredString(input.name, 'name');
    const status = input.status === undefined ? undefined : oneOf(input.status, RECORD_STATUSES, 'status') as RecordStatus;
    const category = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({ where: { id }, data: { ...(name ? { name } : {}), parentId, ...(status ? { status } : {}) } });
      await this.audit.record(context, 'category.updated', 'Category', id, { fields: Object.keys(input) }, tx);
      return updated;
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

  // ───────────── Product types ─────────────

  private async assertTypeTargets(organizationId: string, config: TypeConfig) {
    if (config.categoryIds.length) {
      const found = await this.prisma.category.count({ where: { organizationId, id: { in: config.categoryIds } } });
      if (found !== config.categoryIds.length) throw new BadRequestException('One of the chosen categories was not found');
    }
    if (config.brandIds.length) {
      const found = await this.prisma.brand.count({ where: { organizationId, id: { in: config.brandIds } } });
      if (found !== config.brandIds.length) throw new BadRequestException('One of the chosen brands was not found');
    }
  }

  private productTypeDto(type: { id: string; name: string; description: string; status: RecordStatus; config: unknown; createdAt: Date }, productCount: number) {
    return { id: type.id, name: type.name, description: type.description, status: type.status, config: readTypeConfig(type.config), productCount, createdAt: type.createdAt };
  }

  async listProductTypes(context: UserContext) {
    if (!this.hasOrganizationScope(context, 'catalog.view')) throw new ForbiddenException('Missing organisation-wide permission: catalog.view');
    const [types, counts] = await Promise.all([
      this.prisma.productType.findMany({ where: { organizationId: context.organizationId }, orderBy: { name: 'asc' } }),
      this.prisma.product.groupBy({ by: ['productTypeId'], where: { organizationId: context.organizationId, productTypeId: { not: null } }, _count: { _all: true } }),
    ]);
    const byType = new Map(counts.map((row) => [row.productTypeId, row._count._all]));
    return types.map((type) => this.productTypeDto(type, byType.get(type.id) ?? 0));
  }

  async createProductType(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const name = requiredString(input.name, 'name');
    const config = cleanTypeConfig(input.config);
    await this.assertTypeTargets(context.organizationId, config);
    try {
      const type = await this.prisma.productType.create({ data: { organizationId: context.organizationId, name, description: optionalString(input.description) ?? '', config: config as unknown as Prisma.InputJsonObject } });
      await this.audit.record(context, 'product-type.created', 'ProductType', type.id, { name });
      return this.productTypeDto(type, 0);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A product type with this name already exists');
      throw error;
    }
  }

  async updateProductType(context: UserContext, typeId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.manage');
    const id = uuid(typeId, 'typeId');
    const current = await this.prisma.productType.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Product type not found');
    const status = input.status === undefined ? undefined : oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status');
    const config = input.config === undefined ? undefined : cleanTypeConfig(input.config);
    if (config) await this.assertTypeTargets(context.organizationId, config);
    try {
      const type = await this.prisma.productType.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: requiredString(input.name, 'name') } : {}),
          ...(input.description !== undefined ? { description: optionalString(input.description) ?? '' } : {}),
          ...(status ? { status } : {}),
          ...(config ? { config: config as unknown as Prisma.InputJsonObject } : {}),
        },
      });
      await this.audit.record(context, 'product-type.updated', 'ProductType', id, { changed: Object.keys(input) });
      return this.productTypeDto(type, await this.prisma.product.count({ where: { productTypeId: id } }));
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A product type with this name already exists');
      throw error;
    }
  }

  /** Loads an active type for a product, or explains why it cannot be used. */
  private async usableType(organizationId: string, typeId: string) {
    const type = await this.prisma.productType.findFirst({ where: { id: typeId, organizationId } });
    if (!type) throw new BadRequestException('Product type not found');
    if (type.status !== 'ACTIVE') throw new BadRequestException('This product type is switched off');
    return { id: type.id, name: type.name, config: readTypeConfig(type.config) };
  }

  private async cleanCustomProductFields(organizationId: string, level: 'PRODUCT' | 'VARIANT', incoming: unknown, current: unknown) {
    const settings = await this.getOrganizationSettingsObject(organizationId);
    const definitions = cleanFieldSet(settings.productFields).fields;
    const known = new Set(definitions.filter((field) => field.level === level).map((field) => field.key));
    const values = objectField(current);
    if (incoming !== undefined) {
      const patch = objectField(incoming);
      for (const key of Object.keys(patch)) if (!known.has(key)) throw new BadRequestException(`Unknown product field: ${key}`);
      Object.assign(values, patch);
    }
    // Keep values for disabled definitions so re-enabling a field does not erase catalogue data.
    return cleanFieldValues(definitions.filter((field) => field.level === level), values, { preserveUnknown: true });
  }

  /** The type's rules for the standard fields. Barcode and tax group are checked when variants are saved. */
  private assertProductFitsType(type: { name: string; config: TypeConfig }, fields: { categoryId: string | null; brandId: string | null; brandText: string }) {
    const { config } = type;
    if (config.requireCategory && !fields.categoryId) throw new BadRequestException(`A category is required for ${type.name} products`);
    if (fields.categoryId && config.categoryIds.length && !config.categoryIds.includes(fields.categoryId)) throw new BadRequestException(`This category is not allowed for ${type.name} products`);
    if (config.requireBrand && !fields.brandId && !fields.brandText) throw new BadRequestException(`A brand is required for ${type.name} products`);
    if (fields.brandId && config.brandIds.length && !config.brandIds.includes(fields.brandId)) throw new BadRequestException(`This brand is not allowed for ${type.name} products`);
  }

  /** Barcode requirements of the product's type, checked whenever one of its variants is saved. */
  private async assertVariantFitsType(organizationId: string, productId: string, fields: { hasBarcode: boolean }) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId }, select: { productType: { select: { name: true, config: true } } } });
    if (!product?.productType) return;
    const config = readTypeConfig(product.productType.config);
    if (config.requireBarcode && !fields.hasBarcode) throw new BadRequestException(`A barcode is required for ${product.productType.name} products`);
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
    const variantIds = product.variants.map((variant) => variant.id);
    const [balances, movements, sales] = variantIds.length === 0 ? [[], [], []] : await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where: { organizationId: context.organizationId, variantId: { in: variantIds } },
        include: { location: { select: { id: true, name: true, code: true, store: { select: { id: true, name: true, code: true } } } }, variant: { select: { id: true, sku: true, name: true } } },
        orderBy: [{ location: { name: 'asc' } }, { variant: { name: 'asc' } }],
      }),
      this.prisma.inventoryMovement.findMany({
        where: { organizationId: context.organizationId, variantId: { in: variantIds } },
        include: { location: { select: { name: true, code: true, store: { select: { name: true, code: true } } } }, variant: { select: { sku: true, name: true } } },
        orderBy: { createdAt: 'desc' }, take: 10,
      }),
      this.prisma.saleLine.findMany({
        where: { variantId: { in: variantIds }, sale: { organizationId: context.organizationId } },
        include: { sale: { select: { id: true, receiptNumber: true, storeId: true, createdAt: true, status: true, store: { select: { name: true, code: true } } } }, variant: { select: { sku: true, name: true } } },
        orderBy: { sale: { createdAt: 'desc' } }, take: 10,
      }),
    ]);
    const dto = this.productDto(product);
    const productFieldConfig = cleanFieldSet((await this.getOrganizationSettingsObject(context.organizationId)).productFields);
    const canViewCost = context.isOrganisationAdministrator || this.authorization.hasPermission(context, 'report.view');
    return {
      ...dto,
      productCoreFields: productFieldConfig.coreFields,
      variants: dto.variants.map((variant) => ({ ...variant, ...(canViewCost ? {} : { costCents: undefined }) })),
      stock: balances.map((balance) => ({ variantId: balance.variantId, sku: balance.variant.sku, variantName: balance.variant.name, locationId: balance.locationId, locationName: balance.location.name, locationCode: balance.location.code, storeId: balance.location.store?.id ?? null, storeName: balance.location.store?.name ?? 'Organisation stock', status: balance.status, quantity: Number(balance.quantity), reorderPoint: Number(balance.reorderPoint), safetyStock: Number(balance.safetyStock) })),
      activity: {
        movements: movements.map((movement) => ({ id: movement.id, at: movement.createdAt, type: movement.type, quantity: Number(movement.quantity), status: movement.status, reason: movement.reason, unitCostCents: canViewCost ? movement.unitCostCents : undefined, locationName: movement.location.name, locationCode: movement.location.code, storeName: movement.location.store?.name ?? 'Organisation stock', sku: movement.variant.sku, variantName: movement.variant.name })),
        sales: sales.map((line) => ({ id: line.id, saleId: line.sale.id, receiptNumber: line.sale.receiptNumber, at: line.sale.createdAt, status: line.sale.status, storeId: line.sale.storeId, storeName: line.sale.store.name, storeCode: line.sale.store.code, sku: line.variant.sku, variantName: line.variant.name, quantity: Number(line.quantity), unitPriceCents: line.unitPriceCents, taxCents: line.taxCents, lineTotalCents: line.lineTotalCents, ...(canViewCost ? { unitCostCents: line.unitCostCents } : {}) })),
      },
    };
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
    const customFields = await this.cleanCustomProductFields(context.organizationId, 'PRODUCT', input.customFields, current.customFields);
    const status = input.status === undefined ? undefined : this.productStatus(input.status);
    if (input.categoryId === null || input.categoryId === '') throw new BadRequestException('Category is required');
    const categoryId = input.categoryId === undefined ? undefined : uuid(input.categoryId, 'categoryId');
    if (categoryId && !(await this.prisma.category.findFirst({ where: { id: categoryId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new BadRequestException('Category not found');
    }
    // Product type rules: checked when the type, category, brand or extra fields change.
    const typeChanging = input.productTypeId !== undefined;
    const effectiveTypeId = input.productTypeId === null ? null : typeof input.productTypeId === 'string' ? uuid(input.productTypeId, 'productTypeId') : current.productTypeId;
    let attributePatch: Record<string, string | number | boolean> | undefined;
    if (effectiveTypeId) {
      const touched = typeChanging || input.categoryId !== undefined || input.brandId !== undefined || input.brand !== undefined || input.attributes !== undefined;
      if (touched) {
        const type = await this.usableType(context.organizationId, effectiveTypeId);
        const nextBrandId = input.brandId === null ? null : typeof input.brandId === 'string' ? uuid(input.brandId, 'brandId') : current.brandId;
        const nextCategoryId = categoryId === undefined ? current.categoryId : categoryId;
        this.assertProductFitsType(type, { categoryId: nextCategoryId, brandId: nextBrandId, brandText: input.brand !== undefined ? optionalString(input.brand) ?? '' : current.brand });
        if (input.attributes !== undefined || typeChanging) attributePatch = cleanAttributeValues(type.config, input.attributes !== undefined ? input.attributes : typeChanging ? {} : current.attributes);
      }
    } else if (typeChanging) attributePatch = {};
    else if (input.attributes !== undefined && Object.keys((input.attributes ?? {}) as object).length) throw new BadRequestException('Choose a product type before filling its extra fields');
    const updated = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...(typeChanging ? { productTypeId: effectiveTypeId } : {}),
          ...(attributePatch ? { attributes: attributePatch as Prisma.InputJsonObject } : {}),
          ...(customFields ? { customFields: customFields as Prisma.InputJsonObject } : {}),
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
    const categoryId = uuid(input.categoryId, 'categoryId');
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
    const customFields = await this.cleanCustomProductFields(context.organizationId, 'PRODUCT', input.customFields, {});
    let productTypeId: string | null = null;
    let attributes: Record<string, string | number | boolean> = {};
    if (typeof input.productTypeId === 'string' && input.productTypeId) {
      const type = await this.usableType(context.organizationId, uuid(input.productTypeId, 'productTypeId'));
      this.assertProductFitsType(type, { categoryId, brandId, brandText: brandName });
      attributes = cleanAttributeValues(type.config, input.attributes);
      productTypeId = type.id;
    } else if (input.attributes !== undefined && Object.keys((input.attributes ?? {}) as object).length) throw new BadRequestException('Choose a product type before filling its extra fields');
    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          organizationId: context.organizationId,
          categoryId,
          brandId,
          productTypeId,
          attributes: attributes as Prisma.InputJsonObject,
          customFields: customFields as Prisma.InputJsonObject,
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
    if ('taxGroupId' in input) throw new BadRequestException('Tax groups are assigned by each store, not by the organisation catalog.');
    const product = await this.prisma.product.findFirst({ where: { id: productId, organizationId: context.organizationId }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const customFields = await this.cleanCustomProductFields(context.organizationId, 'VARIANT', input.customFields, {});
    const sku = requiredString(input.sku, 'sku').toUpperCase();
    const name = requiredString(input.name, 'name');
    if (input.uomId === null) throw new BadRequestException('Unit of measure is required');
    const uomId = typeof input.uomId === 'string'
      ? uuid(input.uomId, 'uomId')
      : (await this.prisma.unitOfMeasure.upsert({ where: { organizationId_code: { organizationId: context.organizationId, code: 'PCS' } }, create: { organizationId: context.organizationId, code: 'PCS', name: 'Pieces' }, update: {}, select: { id: true } })).id;
    if (uomId && !(await this.prisma.unitOfMeasure.findFirst({ where: { id: uomId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new BadRequestException('Unit of measure not found');
    }
    let amountCents: number | undefined;
    if (input.amountCents !== undefined) {
      amountCents = Number(input.amountCents);
      if (!Number.isInteger(amountCents) || amountCents < 0) throw new BadRequestException('amountCents must be a non-negative integer');
    }
    const barcode = optionalString(input.barcode);
    await this.assertVariantFitsType(context.organizationId, productId, { hasBarcode: Boolean(barcode) });
    const status = this.productStatus(input.status);
    const costCents = input.costCents === undefined ? 0 : money(input.costCents, 'costCents');
    const openPrice = input.openPrice === true;
    const floorPriceCents = input.floorPriceCents === undefined ? 0 : money(input.floorPriceCents, 'floorPriceCents');

    try {
      await this.prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.create({
          data: { organizationId: context.organizationId, productId, sku, name, status, uomId, costCents, openPrice, floorPriceCents, customFields: customFields as Prisma.InputJsonObject },
        });
        if (barcode) await tx.barcode.create({ data: { organizationId: context.organizationId, variantId: variant.id, code: barcode } });
        if (amountCents !== undefined) {
          await tx.variantPrice.create({
            data: {
              organizationId: context.organizationId,
              variantId: variant.id,
              amountCents,
              currency: optionalString(input.currency) || await this.orgCurrency(context.organizationId),
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
    if ('taxGroupId' in input) throw new BadRequestException('Tax groups are assigned by each store, not by the organisation catalog.');
    const id = uuid(variantId, 'variantId');
    const current = await this.prisma.productVariant.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Variant not found');
    const customFields = await this.cleanCustomProductFields(context.organizationId, 'VARIANT', input.customFields, current.customFields);
    const status = input.status === undefined ? undefined : this.productStatus(input.status);
    const costCents = input.costCents === undefined ? undefined : money(input.costCents, 'costCents');
    if (input.uomId === null) throw new BadRequestException('Unit of measure is required');
    const uomId = input.uomId === undefined ? undefined : uuid(input.uomId, 'uomId');
    if (uomId && !(await this.prisma.unitOfMeasure.findFirst({ where: { id: uomId, organizationId: context.organizationId }, select: { id: true } }))) throw new BadRequestException('Unit of measure not found');
    {
      const barcodeCount = Array.isArray(input.barcodes) ? stringArray(input.barcodes).length : await this.prisma.barcode.count({ where: { variantId: id } });
      await this.assertVariantFitsType(context.organizationId, current.productId, { hasBarcode: barcodeCount > 0 });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.update({ where: { id }, data: {
        ...(optionalString(input.sku) ? { sku: optionalString(input.sku)?.toUpperCase() } : {}),
        ...(optionalString(input.name) ? { name: optionalString(input.name) } : {}),
        ...(status ? { status } : {}),
        ...(costCents !== undefined ? { costCents } : {}),
        ...(input.openPrice !== undefined ? { openPrice: input.openPrice === true } : {}),
        ...(input.floorPriceCents !== undefined ? { floorPriceCents: money(input.floorPriceCents, 'floorPriceCents') } : {}),
        ...(uomId !== undefined ? { uomId } : {}),
        ...(customFields ? { customFields: customFields as Prisma.InputJsonObject } : {}),
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
        await tx.variantPrice.create({ data: { organizationId: context.organizationId, variantId: id, amountCents, currency: optionalString(input.currency) || await this.orgCurrency(context.organizationId), includesTax: input.includesTax === true } });
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
      const category = typeof row.category === 'string' ? row.category.trim() : '';
      const rate = Number(row.ratePercent ?? row.gst ?? 0);
      const cost = row.costCents === undefined ? 0 : Number(row.costCents);
      if (!sku) errors.push({ row: rowNumber, field: 'sku', message: 'SKU is required' });
      if (!name) errors.push({ row: rowNumber, field: 'name', message: 'Product name is required' });
      if (!category) errors.push({ row: rowNumber, field: 'category', message: 'Category is required' });
      if (!Number.isFinite(price) || price < 0 || (hasPriceCents && !Number.isInteger(price))) errors.push({ row: rowNumber, field: 'price', message: 'Price must be non-negative; priceCents must be an integer in the currency minor unit' });
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) errors.push({ row: rowNumber, field: 'ratePercent', message: 'Tax rate must be between 0 and 100' });
      if (!Number.isInteger(cost) || cost < 0) errors.push({ row: rowNumber, field: 'costCents', message: 'costCents must be a non-negative integer in the currency minor unit' });
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
    const currency = await this.orgCurrency(context.organizationId);
    await this.prisma.$transaction(async (tx) => {
      const products = new Map<string, { id: string }>();
      for (const row of rows) {
        const sku = String(row.sku).trim().toUpperCase();
        const name = String(row.name).trim();
        const productName = optionalString(row.productName) || name;
        const categoryName = optionalString(row.category);
        const brand = optionalString(row.brand) || '';
        const amountCents = row.priceCents !== undefined ? money(row.priceCents, 'priceCents') : Math.round(Number(row.price) * minorFactor(currency));
        const category = await tx.category.findFirst({ where: { organizationId: context.organizationId, name: categoryName } })
          ?? await tx.category.create({ data: { organizationId: context.organizationId, name: categoryName! } });
        const productKey = `${productName}\u0000${category?.id ?? ''}\u0000${brand}`;
        let product = products.get(productKey);
        if (!product) {
          product = await tx.product.create({ data: { organizationId: context.organizationId, categoryId: category.id, name: productName, brand }, select: { id: true } });
          products.set(productKey, product);
        }
        const costCents = row.costCents !== undefined ? money(row.costCents, 'costCents') : 0;
        const uom = await tx.unitOfMeasure.upsert({ where: { organizationId_code: { organizationId: context.organizationId, code: 'PCS' } }, create: { organizationId: context.organizationId, code: 'PCS', name: 'Pieces' }, update: {}, select: { id: true } });
        const variant = await tx.productVariant.create({ data: { organizationId: context.organizationId, productId: product.id, sku, name, costCents, uomId: uom.id } });
        const barcode = optionalString(row.barcode);
        if (barcode) await tx.barcode.create({ data: { organizationId: context.organizationId, variantId: variant.id, code: barcode } });
        await tx.variantPrice.create({ data: { organizationId: context.organizationId, variantId: variant.id, amountCents, currency, includesTax: row.includesTax === true } });
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

  /** Saves the required setup and first store atomically; retrying reuses the first active store. */
  async completeRequiredOnboarding(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const orgInput = input.organization && typeof input.organization === 'object' && !Array.isArray(input.organization) ? input.organization as JsonObject : {};
    const storeInput = input.store && typeof input.store === 'object' && !Array.isArray(input.store) ? input.store as JsonObject : {};
    const name = requiredString(orgInput.name, 'organization.name');
    if (name.length < 2 || name.length > 120) throw new BadRequestException('Organisation name must be between 2 and 120 characters');
    const countryCode = oneOf(orgInput.countryCode, MARKETS.map((market) => market.code), 'organization.countryCode');
    if (!isMarketCode(countryCode)) throw new BadRequestException('Choose a supported country or region');
    if (!isCurrencyCode(orgInput.currency)) throw new BadRequestException('Choose a supported base currency');
    const currency = orgInput.currency;
    const businessType = oneOf(orgInput.businessType ?? 'RETAIL', ['RETAIL', 'GROCERY', 'PHARMACY', 'OTHER'] as const, 'organization.businessType');
    const taxRegime = oneOf(orgInput.taxRegime ?? taxRegimeFor(countryCode), ['GST', 'VAT', 'TAX'] as const, 'organization.taxRegime');
    const taxProfileStatus = oneOf(orgInput.taxProfileStatus, ['REGISTERED', 'NOT_REGISTERED', 'UNSURE'] as const, 'organization.taxProfileStatus');
    const rawGstin = optionalString(orgInput.gstin) ?? '';
    let gstin = '';
    if ((countryCode === 'IN' || countryCode === 'OM') && taxProfileStatus === 'REGISTERED') {
      const result = validateTaxNumber(countryCode, rawGstin);
      if (!result.valid) throw new BadRequestException(result.error ?? (countryCode === 'OM' ? 'Enter a valid VAT number' : 'Enter a valid GSTIN'));
      gstin = result.normalized;
    } else if (rawGstin) {
      const result = validateTaxNumber(countryCode, rawGstin);
      if (!result.valid) throw new BadRequestException(result.error ?? 'Enter a valid tax number');
      gstin = result.normalized;
    }
    const market = MARKETS.find((entry) => entry.code === countryCode)!;
    const organizationTimezone = optionalString(orgInput.timezone) || market.timezone;
    try { new Intl.DateTimeFormat('en', { timeZone: organizationTimezone }); }
    catch { throw new BadRequestException('Choose a valid organisation time zone'); }

    const storeName = requiredString(storeInput.name, 'store.name');
    if (storeName.length > 120) throw new BadRequestException('Store name must be 120 characters or fewer');
    // Omani stores send structured address parts; everything else (and older clients) sends address and city directly.
    const structured = this.addressFromInput(storeInput);
    const address = structured?.address ?? requiredString(storeInput.address, 'store.address');
    if (!address.trim()) throw new BadRequestException('store.address is required');
    const city = structured?.city ?? optionalString(storeInput.city) ?? '';
    const region = structured?.region ?? optionalString(storeInput.region) ?? '';
    const postalCode = structured?.postalCode ?? optionalString(storeInput.postalCode) ?? '';
    const phone = this.phoneFromInput(countryCode, optionalString(storeInput.phone) ?? '');
    const addressDetails = (structured?.addressDetails ?? {}) as Prisma.InputJsonObject;
    const storeTimezone = optionalString(storeInput.timezone) || organizationTimezone;
    const organizationAddress = this.addressFromInput(orgInput);
    try { new Intl.DateTimeFormat('en', { timeZone: storeTimezone }); }
    catch { throw new BadRequestException('Choose a valid store time zone'); }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${context.organizationId}::uuid FOR UPDATE`;
        const organization = await tx.organization.findUnique({ where: { id: context.organizationId }, select: { status: true } });
        if (!organization || organization.status !== 'ACTIVE') throw new BadRequestException('Organisation is not active');
        const entitlement = await tx.organizationEntitlement.findUnique({ where: { organizationId: context.organizationId } });
        if (!entitlement || entitlement.maxStores < 1) throw new ConflictException('The organisation does not have an available store');

        let store = await tx.store.findFirst({ where: { organizationId: context.organizationId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
        if (store) {
          store = await tx.store.update({
            where: { id: store.id },
            data: { name: storeName, address, city, region, postalCode, phone, timezone: storeTimezone, ...(structured ? { addressDetails } : {}) },
          });
        } else {
          const activeCount = await tx.store.count({ where: { organizationId: context.organizationId, status: 'ACTIVE' } });
          if (activeCount >= entitlement.maxStores) throw new ConflictException(`Store limit reached (${entitlement.maxStores})`);
          let code = 'STORE-01';
          for (let sequence = 1; await tx.store.findUnique({ where: { organizationId_code: { organizationId: context.organizationId, code } }, select: { id: true } }); sequence += 1) {
            code = `STORE-${String(sequence + 1).padStart(2, '0')}`;
            if (sequence >= 999) throw new ConflictException('Could not generate a unique store code');
          }
          store = await tx.store.create({ data: { organizationId: context.organizationId, code, name: storeName, address, city, region, postalCode, phone, timezone: storeTimezone, addressDetails, billingSettings: DEFAULT_BILLING_SETTINGS as Prisma.InputJsonObject } });
        }

        await tx.stockLocation.upsert({
          where: { organizationId_code: { organizationId: context.organizationId, code: `${store.code}-STOCKROOM` } },
          create: { organizationId: context.organizationId, storeId: store.id, code: `${store.code}-STOCKROOM`, name: `${store.name} Stockroom` },
          update: { storeId: store.id, name: `${store.name} Stockroom`, status: 'ACTIVE' },
        });
        let register = await tx.register.findFirst({ where: { storeId: store.id, organizationId: context.organizationId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
        if (!register) {
          const existingRegister = await tx.register.findUnique({ where: { storeId_code: { storeId: store.id, code: 'REG-01' } } });
          register = existingRegister
            ? await tx.register.update({ where: { id: existingRegister.id }, data: { name: existingRegister.name || 'Front Register', status: 'ACTIVE' } })
            : await tx.register.create({ data: { organizationId: context.organizationId, storeId: store.id, code: 'REG-01', name: 'Front Register' } });
        }

        // A starting rate is editable at store level; it does not force every product to use it.
        if (countryCode === 'OM' && taxRegime === 'VAT' && taxProfileStatus === 'REGISTERED') {
          await tx.taxGroup.upsert({
            where: { organizationId_storeId_code: { organizationId: context.organizationId, storeId: store.id, code: 'VAT5' } },
            create: { organizationId: context.organizationId, storeId: store.id, code: 'VAT5', name: 'VAT 5%', rateBps: 500 },
            update: {},
          });
        }

        await tx.organization.update({
          where: { id: context.organizationId },
          data: { name, address: organizationAddress?.address ?? optionalString(orgInput.address) ?? '', ...(organizationAddress ? { addressDetails: organizationAddress.addressDetails as Prisma.InputJsonObject } : {}), countryCode, currency, businessType, timezone: organizationTimezone, taxRegime, taxProfileStatus, gstin },
        });
        await tx.user.update({ where: { id: context.userId }, data: { defaultStoreId: store.id } });
        await tx.userStore.updateMany({ where: { userId: context.userId }, data: { isDefault: false } });
        await tx.userStore.upsert({
          where: { userId_storeId: { userId: context.userId, storeId: store.id } },
          create: { userId: context.userId, storeId: store.id, isDefault: true },
          update: { isDefault: true },
        });
        const storeManagerRole = await tx.role.findUnique({ where: { organizationId_name: { organizationId: context.organizationId, name: 'Store Manager' } }, select: { id: true } });
        if (!storeManagerRole) throw new ConflictException('The Store Manager role is not configured');
        const ownerStoreRole = await tx.userRole.findFirst({ where: { userId: context.userId, roleId: storeManagerRole.id, scopeType: 'STORE', storeId: store.id }, select: { id: true } });
        if (!ownerStoreRole) await tx.userRole.create({ data: { organizationId: context.organizationId, userId: context.userId, roleId: storeManagerRole.id, scopeType: 'STORE', storeId: store.id } });

        const prior = await tx.organizationSettings.findUnique({ where: { organizationId: context.organizationId }, select: { settings: true } });
        const settings = (prior?.settings && typeof prior.settings === 'object' && !Array.isArray(prior.settings) ? prior.settings : {}) as JsonObject;
        const existingOnboarding = settings.onboarding && typeof settings.onboarding === 'object' && !Array.isArray(settings.onboarding) ? settings.onboarding as JsonObject : {};
        const onboarding = {
          ...existingOnboarding,
          version: 2,
          currentStep: 2,
          completedSteps: [0, 1],
          complete: true,
          required: false,
          optionalSkippedAt: null,
          data: { ...(existingOnboarding.data && typeof existingOnboarding.data === 'object' && !Array.isArray(existingOnboarding.data) ? existingOnboarding.data as JsonObject : {}), organization: { name, countryCode, currency, businessType, timezone: organizationTimezone, taxProfileStatus, gstin }, store: { name: storeName, address, city, region, postalCode, phone, timezone: storeTimezone, addressDetails } },
        };
        const nextSettings: JsonObject = { ...settings, defaultStoreId: store.id, ...(Array.isArray(settings.enabledTenders) ? {} : { enabledTenders: ['CASH'] }), onboarding };
        await tx.organizationSettings.upsert({
          where: { organizationId: context.organizationId },
          create: { organizationId: context.organizationId, settings: nextSettings as Prisma.InputJsonObject },
          update: { settings: nextSettings as Prisma.InputJsonObject },
        });
        await this.audit.record(context, 'onboarding.required-completed', 'OrganizationSettings', context.organizationId, { storeId: store.id, countryCode, currency, taxProfileStatus }, tx);
        return { onboarding, organization: { name, countryCode, currency, businessType, timezone: organizationTimezone, taxProfileStatus }, store: { id: store.id, code: store.code, name: store.name, register: { id: register.id, code: register.code, name: register.name } } };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Could not create the first store because its generated code is already in use');
      throw error;
    }
  }

  async skipOptionalOnboarding(context: UserContext) {
    this.requireOrganizationPermission(context, 'org.settings.manage');
    const current = (await this.getOnboarding(context)).onboarding;
    if (current.complete !== true) throw new BadRequestException('Complete the organisation and first-store setup before skipping optional setup');
    const optionalSkippedAt = new Date().toISOString();
    await this.prisma.$executeRaw`UPDATE organization_settings
      SET settings = jsonb_set(settings, '{onboarding}',
        COALESCE(settings->'onboarding', '{}'::jsonb) || jsonb_build_object('optionalSkippedAt', ${optionalSkippedAt}::text), true)
      WHERE organization_id = ${context.organizationId}::uuid`;
    const onboarding = { ...current, optionalSkippedAt } as JsonObject;
    await this.audit.record(context, 'onboarding.optional-skipped', 'OrganizationSettings', context.organizationId, {}, undefined);
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
      const timezone = optionalString(value.timezone) || DEFAULT_TIMEZONE;
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
            : await tx.store.create({ data: { organizationId: context.organizationId, code: draft.code, name: draft.name, address: draft.address, timezone: draft.timezone, closeHour: draft.closeHour, billingSettings: DEFAULT_BILLING_SETTINGS as Prisma.InputJsonObject } });
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
      },
    });
    if (stores.length === 0) throw new BadRequestException('Create at least one store before finishing setup');
    const missingRegister = stores.find((store) => store.registers.length === 0);
    if (missingRegister) throw new BadRequestException(`${missingRegister.name} needs an active register`);
    const settings = (await this.getSettings(context)).settings;
    const onboarding = { ...((settings.onboarding ?? {}) as JsonObject), version: 2, currentStep: 2, completedSteps: [0, 1], complete: true, required: false };
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

  /** Store provisioning may be performed by organisation admins or by an explicitly authorized store manager. */
  private requireStoreOrOrganizationPermission(context: UserContext, permissionCode: string, storeId: string): void {
    if (!this.authorization.hasPermission(context, permissionCode, storeId) && !this.authorization.hasPermission(context, permissionCode)) {
      throw new ForbiddenException(`Missing permission: ${permissionCode}`);
    }
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
      storeAssignable: role.storeAssignable,
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
      productTypeId: product.productTypeId,
      productType: product.productType,
      attributes: product.attributes,
      customFields: product.customFields,
      status: product.status,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        productId: variant.productId,
        sku: variant.sku,
        name: variant.name,
        costCents: variant.costCents,
        openPrice: variant.openPrice,
        floorPriceCents: variant.floorPriceCents,
        status: variant.status,
        customFields: variant.customFields,
        uomId: variant.uomId,
        uomCode: variant.uom?.code ?? null,
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

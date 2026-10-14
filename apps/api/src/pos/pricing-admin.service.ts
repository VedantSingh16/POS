import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { UserContext } from '../auth/auth.types.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { finiteNumber, JsonObject, money, oneOf, requiredString, uuid } from '../common/input.js';
import { isUniqueViolation, num } from '../database/db.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, PriceRuleMode, PriceRuleScope, PromotionType } from '../generated/prisma/client.js';

const SCOPES = Object.values(PriceRuleScope) as PriceRuleScope[];
const MODES = Object.values(PriceRuleMode) as PriceRuleMode[];

/** Store-scoped price rules, discount reasons and promotion settings. */
@Injectable()
export class PricingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private requireOrganizationPermission(context: UserContext, permissionCode: string): void {
    if (!context.isOrganisationAdministrator && !context.grants.some((grant) => grant.permissionCode === permissionCode && grant.scopeType === 'ORGANIZATION' && grant.effect !== 'DENY')) {
      throw new ForbiddenException(`Missing organisation-wide permission: ${permissionCode}`);
    }
  }

  private date(value: unknown, field: string): Date | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return parsed;
  }

  // ───────────── Price rules ─────────────

  private ruleDto(rule: Prisma.PriceRuleGetPayload<object>) {
    return {
      id: rule.id, name: rule.name, priority: rule.priority, scope: rule.scope, scopeId: rule.scopeId, storeId: rule.storeId,
      customerGroup: rule.customerGroup, minQuantity: num(rule.minQuantity), startsAt: rule.startsAt, endsAt: rule.endsAt,
      mode: rule.mode, value: rule.value, status: rule.status,
    };
  }

  async listPriceRules(context: UserContext, requestedStoreId?: string) {
    if (!requestedStoreId) throw new BadRequestException('storeId is required for store-owned price rules');
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['pricing.view'], storeId);
    const rules = await this.prisma.priceRule.findMany({ where: { organizationId: context.organizationId, storeId }, orderBy: [{ priority: 'desc' }, { name: 'asc' }] });
    return rules.map((rule) => this.ruleDto(rule));
  }

  private async ruleData(context: UserContext, input: JsonObject, partial: boolean) {
    const data: Prisma.PriceRuleUncheckedUpdateInput = {};
    if (!partial || input.name !== undefined) data.name = requiredString(input.name, 'name');
    if (input.priority !== undefined) data.priority = Math.trunc(finiteNumber(input.priority, 'priority'));
    if (!partial || input.scope !== undefined) data.scope = input.scope === undefined ? 'ALL' : oneOf(input.scope, SCOPES, 'scope');
    if (!partial || input.mode !== undefined) data.mode = input.mode === undefined ? 'FIXED' : oneOf(input.mode, MODES, 'mode');
    if (!partial || input.value !== undefined) {
      const value = Math.trunc(finiteNumber(input.value, 'value'));
      if (value < 0) throw new BadRequestException('value must not be negative');
      data.value = value;
    }
    if (input.scopeId !== undefined) data.scopeId = input.scopeId === null ? null : uuid(input.scopeId, 'scopeId');
    if (input.storeId !== undefined) {
      if (input.storeId === null) throw new BadRequestException('A price rule must belong to a store');
      data.storeId = uuid(input.storeId, 'storeId');
    }
    if (input.customerGroup !== undefined) data.customerGroup = input.customerGroup === null || input.customerGroup === '' ? null : requiredString(input.customerGroup, 'customerGroup');
    if (input.minQuantity !== undefined) {
      const minimum = finiteNumber(input.minQuantity, 'minQuantity');
      if (minimum <= 0) throw new BadRequestException('minQuantity must be greater than zero');
      data.minQuantity = minimum;
    }
    if (input.startsAt !== undefined) data.startsAt = this.date(input.startsAt, 'startsAt');
    if (input.endsAt !== undefined) data.endsAt = this.date(input.endsAt, 'endsAt');
    if (input.status !== undefined) data.status = oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status');
    if (data.mode === 'PERCENT_OFF' && typeof data.value === 'number' && data.value > 10_000) throw new BadRequestException('A percentage rule cannot take off more than 100% (10000 basis points)');
    // A scoped rule needs something to point at, and that thing must belong to this organisation.
    const scope = (data.scope as PriceRuleScope | undefined) ?? undefined;
    if (scope && scope !== 'ALL' && !data.scopeId) throw new BadRequestException('scopeId is required for a variant, category or brand rule');
    if (data.scopeId && scope) await this.assertScopeTarget(context.organizationId, scope, data.scopeId as string);
    if (data.storeId) {
      const store = await this.prisma.store.findFirst({ where: { id: data.storeId as string, organizationId: context.organizationId }, select: { id: true } });
      if (!store) throw new BadRequestException('Store not found');
    }
    return data;
  }

  private async assertScopeTarget(organizationId: string, scope: PriceRuleScope, scopeId: string) {
    const found = scope === 'VARIANT'
      ? await this.prisma.productVariant.findFirst({ where: { id: scopeId, organizationId }, select: { id: true } })
      : scope === 'CATEGORY'
        ? await this.prisma.category.findFirst({ where: { id: scopeId, organizationId }, select: { id: true } })
        : scope === 'BRAND'
          ? await this.prisma.brand.findFirst({ where: { id: scopeId, organizationId }, select: { id: true } })
          : true;
    if (!found) throw new BadRequestException(`The ${scope.toLowerCase()} for this rule was not found`);
  }

  async createPriceRule(context: UserContext, input: JsonObject) {
    const storeId = typeof input.storeId === 'string' ? uuid(input.storeId, 'storeId') : null;
    if (!storeId) throw new BadRequestException('storeId is required for a price rule');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['pricing.manage'], storeId);
    const data = await this.ruleData(context, input, false);
    const rule = await this.prisma.priceRule.create({ data: { ...(data as Prisma.PriceRuleUncheckedCreateInput), organizationId: context.organizationId, storeId } });
    await this.audit.record(context, 'price-rule.created', 'PriceRule', rule.id, { name: rule.name, mode: rule.mode, value: rule.value });
    return this.ruleDto(rule);
  }

  async updatePriceRule(context: UserContext, ruleId: string, input: JsonObject) {
    const current = await this.prisma.priceRule.findFirst({ where: { id: uuid(ruleId, 'ruleId'), organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Price rule not found');
    if (!current.storeId) throw new ForbiddenException('Organization-wide price rules are no longer configurable; create a rule in a store.');
    if (input.storeId !== undefined && input.storeId !== current.storeId) throw new BadRequestException('Price rule belongs to a different store');
    this.authorization.assertStoreAccess(context, current.storeId);
    this.authorization.assertPermissions(context, ['pricing.manage'], current.storeId);
    const merged: JsonObject = { scope: current.scope, ...input };
    if (input.scopeId === undefined && input.scope === undefined) delete merged.scope;
    const data = await this.ruleData(context, merged, true);
    const rule = await this.prisma.priceRule.update({ where: { id: current.id }, data });
    await this.audit.record(context, 'price-rule.updated', 'PriceRule', rule.id, { changed: Object.keys(input) });
    return this.ruleDto(rule);
  }

  // ───────────── Discount reasons ─────────────

  async listDiscountReasons(context: UserContext, storeId?: string) {
    if (!storeId) throw new BadRequestException('storeId is required for store-owned discount reasons');
    const id = uuid(storeId, 'storeId');
    this.authorization.assertStoreAccess(context, id);
    this.authorization.assertPermissions(context, ['pricing.view'], id);
    const reasons = await this.prisma.discountReason.findMany({ where: { organizationId: context.organizationId, storeId: id }, orderBy: { name: 'asc' } });
    return reasons.map((reason) => ({ id: reason.id, code: reason.code, name: reason.name, status: reason.status }));
  }

  async createDiscountReason(context: UserContext, input: JsonObject) {
    const storeId = typeof input.storeId === 'string' ? uuid(input.storeId, 'storeId') : null;
    if (!storeId) throw new BadRequestException('storeId is required for a discount reason');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['pricing.manage'], storeId);
    try {
      const reason = await this.prisma.discountReason.create({ data: { organizationId: context.organizationId, storeId, code: requiredString(input.code, 'code').toUpperCase(), name: requiredString(input.name, 'name') } });
      await this.audit.record(context, 'discount-reason.created', 'DiscountReason', reason.id, { code: reason.code });
      return { id: reason.id, code: reason.code, name: reason.name, status: reason.status };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A discount reason with this code already exists');
      throw error;
    }
  }

  async updateDiscountReason(context: UserContext, reasonId: string, input: JsonObject) {
    const current = await this.prisma.discountReason.findFirst({ where: { id: uuid(reasonId, 'reasonId'), organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Discount reason not found');
    if (!current.storeId) throw new ForbiddenException('Organization-wide discount reasons are no longer configurable; create one in a store.');
    if (input.storeId !== undefined && input.storeId !== current.storeId) throw new BadRequestException('Discount reason belongs to a different store');
    this.authorization.assertStoreAccess(context, current.storeId);
    this.authorization.assertPermissions(context, ['pricing.manage'], current.storeId);
    const reason = await this.prisma.discountReason.update({
      where: { id: current.id },
      data: {
        ...(input.name !== undefined ? { name: requiredString(input.name, 'name') } : {}),
        ...(input.status !== undefined ? { status: oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status') } : {}),
      },
    });
    return { id: reason.id, code: reason.code, name: reason.name, status: reason.status };
  }

  // ───────────── Promotion settings ─────────────

  async updatePromotion(context: UserContext, promotionId: string, input: JsonObject) {
    const current = await this.prisma.promotion.findFirst({ where: { id: uuid(promotionId, 'promotionId'), organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Promotion not found');
    if (!current.storeId) throw new ForbiddenException('Organization-wide promotions are no longer configurable; create one in a store.');
    if (input.storeId !== undefined && input.storeId !== current.storeId) throw new BadRequestException('Promotion belongs to a different store');
    this.authorization.assertStoreAccess(context, current.storeId);
    this.authorization.assertPermissions(context, ['pricing.manage'], current.storeId);
    const type = input.type === undefined ? current.type : oneOf(input.type, Object.values(PromotionType) as PromotionType[], 'type');
    const value = input.value === undefined ? num(current.value) : finiteNumber(input.value, 'value');
    if (value <= 0 || (type === 'PERCENT' && value > 100)) throw new BadRequestException('Promotion value is out of range');
    const scope = input.scope === undefined ? current.scope : oneOf(input.scope, SCOPES, 'scope');
    const scopeId = input.scopeId === undefined ? current.scopeId : input.scopeId === null ? null : uuid(input.scopeId, 'scopeId');
    if (scope !== 'ALL' && !scopeId) throw new BadRequestException('scopeId is required for a variant, category or brand promotion');
    if (scope !== 'ALL' && scopeId) await this.assertScopeTarget(context.organizationId, scope, scopeId);
    const promotion = await this.prisma.promotion.update({
      where: { id: current.id },
      data: {
        type, value, scope, scopeId: scope === 'ALL' ? null : scopeId,
        ...(input.minSubtotalCents !== undefined ? { minSubtotalCents: money(input.minSubtotalCents, 'minSubtotalCents') } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit === null ? null : Math.trunc(finiteNumber(input.usageLimit, 'usageLimit')) } : {}),
        ...(input.perCustomerLimit !== undefined ? { perCustomerLimit: input.perCustomerLimit === null ? null : Math.trunc(finiteNumber(input.perCustomerLimit, 'perCustomerLimit')) } : {}),
        ...(input.startsAt !== undefined ? { startsAt: this.date(input.startsAt, 'startsAt') } : {}),
        ...(input.endsAt !== undefined ? { endsAt: this.date(input.endsAt, 'endsAt') } : {}),
        ...(input.autoApply !== undefined ? { autoApply: input.autoApply === true } : {}),
        ...(input.stackable !== undefined ? { stackable: input.stackable === true } : {}),
        ...(input.priority !== undefined ? { priority: Math.trunc(finiteNumber(input.priority, 'priority')) } : {}),
        ...(input.status !== undefined ? { status: oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status') } : {}),
      },
    });
    await this.audit.record(context, 'promotion.updated', 'Promotion', promotion.id, { changed: Object.keys(input) });
    return {
      id: promotion.id, code: promotion.code, type: promotion.type, value: num(promotion.value), minSubtotalCents: promotion.minSubtotalCents,
      usageLimit: promotion.usageLimit, usageCount: promotion.usageCount, perCustomerLimit: promotion.perCustomerLimit, startsAt: promotion.startsAt,
      endsAt: promotion.endsAt, status: promotion.status, scope: promotion.scope, scopeId: promotion.scopeId, autoApply: promotion.autoApply,
      priority: promotion.priority, stackable: promotion.stackable,
    };
  }
}

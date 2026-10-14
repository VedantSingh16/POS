/**
 * Pure pricing rules (no database): price-rule resolution and promotion evaluation.
 * All money is integer paise. Percent discounts on price rules use basis points (1000 = 10 %).
 */

export type PriceRuleScope = 'ALL' | 'CATEGORY' | 'BRAND' | 'VARIANT';
export type PriceRuleMode = 'FIXED' | 'PERCENT_OFF' | 'AMOUNT_OFF';

export type PriceRule = {
  id: string;
  name: string;
  /** Higher wins. */
  priority: number;
  scope: PriceRuleScope;
  scopeId: string | null;
  /** null = every store. */
  storeId: string | null;
  /** null = every customer group. */
  customerGroup: string | null;
  minQuantity: number;
  startsAt: Date | null;
  endsAt: Date | null;
  mode: PriceRuleMode;
  /** FIXED: paise. PERCENT_OFF: basis points. AMOUNT_OFF: paise. */
  value: number;
};

export type PriceContext = {
  storeId: string | null;
  variantId: string;
  categoryId: string | null;
  brandId: string | null;
  customerGroup: string | null;
  quantity: number;
  now: Date;
};

export type ResolvedPrice = {
  unitPriceCents: number | null;
  source: 'RULE' | 'BASE' | 'NONE';
  ruleId: string | null;
  ruleName: string | null;
};

const SCOPE_RANK: Record<PriceRuleScope, number> = { VARIANT: 3, CATEGORY: 2, BRAND: 2, ALL: 0 };

function sameGroup(a: string | null, b: string | null): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

export function priceRuleApplies(rule: PriceRule, ctx: PriceContext): boolean {
  if (rule.storeId !== null && rule.storeId !== ctx.storeId) return false;
  if (rule.customerGroup !== null && !sameGroup(rule.customerGroup, ctx.customerGroup)) return false;
  if (ctx.quantity < rule.minQuantity) return false;
  if (rule.startsAt && ctx.now < rule.startsAt) return false;
  if (rule.endsAt && ctx.now > rule.endsAt) return false;
  if (rule.scope === 'VARIANT') return rule.scopeId === ctx.variantId;
  if (rule.scope === 'CATEGORY') return rule.scopeId !== null && rule.scopeId === ctx.categoryId;
  if (rule.scope === 'BRAND') return rule.scopeId !== null && rule.scopeId === ctx.brandId;
  return true;
}

function compareRules(a: PriceRule, b: PriceRule): number {
  return (
    b.priority - a.priority ||
    SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope] ||
    Number(b.storeId !== null) - Number(a.storeId !== null) ||
    Number(b.customerGroup !== null) - Number(a.customerGroup !== null) ||
    b.minQuantity - a.minQuantity ||
    a.id.localeCompare(b.id)
  );
}

function priceFromRule(rule: PriceRule, baseCents: number | null): number | null {
  if (rule.mode === 'FIXED') return Math.max(0, Math.round(rule.value));
  if (baseCents === null) return null; // a discount rule needs a base price to discount
  if (rule.mode === 'PERCENT_OFF') return Math.max(0, Math.round((baseCents * (10_000 - Math.min(10_000, rule.value))) / 10_000));
  return Math.max(0, baseCents - Math.round(rule.value));
}

/** The first matching rule by priority wins; the base price is the last fallback; no price at all returns NONE. */
export function resolveUnitPrice(baseCents: number | null, rules: PriceRule[], ctx: PriceContext): ResolvedPrice {
  for (const rule of rules.filter((candidate) => priceRuleApplies(candidate, ctx)).sort(compareRules)) {
    const price = priceFromRule(rule, baseCents);
    if (price !== null) return { unitPriceCents: price, source: 'RULE', ruleId: rule.id, ruleName: rule.name };
  }
  if (baseCents === null) return { unitPriceCents: null, source: 'NONE', ruleId: null, ruleName: null };
  return { unitPriceCents: baseCents, source: 'BASE', ruleId: null, ruleName: null };
}

// ───────────────────────── Promotions ─────────────────────────

export type PromotionScope = 'ALL' | 'CATEGORY' | 'BRAND' | 'VARIANT';

export type PromotionDef = {
  id: string;
  code: string;
  type: 'PERCENT' | 'AMOUNT';
  /** PERCENT: 0-100. AMOUNT: paise. */
  value: number;
  minSubtotalCents: number;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  scope: PromotionScope;
  scopeId: string | null;
  autoApply: boolean;
  /** Higher is considered first. */
  priority: number;
  stackable: boolean;
};

export type PromotionLine = { variantId: string; categoryId: string | null; brandId: string | null; netCents: number };

export type PromotionRejection = 'NOT_FOUND' | 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'LIMIT_REACHED' | 'CUSTOMER_LIMIT' | 'MIN_SUBTOTAL' | 'NOT_APPLICABLE' | 'SUPERSEDED';

export type PromotionResult = {
  applied: { promotionId: string; code: string; discountCents: number }[];
  rejected: { code: string; reason: PromotionRejection }[];
  totalDiscountCents: number;
};

function eligibleBase(promotion: PromotionDef, lines: PromotionLine[]): number {
  return lines
    .filter((line) => promotion.scope === 'ALL'
      || (promotion.scope === 'VARIANT' && line.variantId === promotion.scopeId)
      || (promotion.scope === 'CATEGORY' && promotion.scopeId !== null && line.categoryId === promotion.scopeId)
      || (promotion.scope === 'BRAND' && promotion.scopeId !== null && line.brandId === promotion.scopeId))
    .reduce((sum, line) => sum + line.netCents, 0);
}

/**
 * Evaluates automatic promotions plus at most one coupon code.
 * Stacking: the best candidate (priority, then value) always applies. A further promotion applies only if it and
 * every promotion already applied are marked stackable; otherwise it is rejected as SUPERSEDED.
 * The combined discount never exceeds the net subtotal.
 */
export function evaluatePromotions(input: {
  promotions: PromotionDef[];
  couponCode?: string | null;
  lines: PromotionLine[];
  /** Past redemptions of each promotion by the attached customer. */
  customerRedemptions?: Map<string, number>;
  hasCustomer: boolean;
  now: Date;
}): PromotionResult {
  const rejected: PromotionResult['rejected'] = [];
  const coupon = input.couponCode?.trim().toUpperCase() || null;
  const candidates: PromotionDef[] = input.promotions.filter((promotion) => promotion.autoApply);
  if (coupon) {
    const match = input.promotions.find((promotion) => promotion.code.toUpperCase() === coupon);
    if (!match) rejected.push({ code: coupon, reason: 'NOT_FOUND' });
    else if (!candidates.includes(match)) candidates.push(match);
  }
  const subtotal = input.lines.reduce((sum, line) => sum + line.netCents, 0);

  const valid: { promotion: PromotionDef; discountCents: number }[] = [];
  for (const promotion of candidates) {
    const reject = (reason: PromotionRejection) => {
      // Automatic promotions that simply do not apply are not worth reporting.
      if (promotion.autoApply && coupon !== promotion.code.toUpperCase() && (reason === 'NOT_APPLICABLE' || reason === 'MIN_SUBTOTAL' || reason === 'NOT_STARTED')) return;
      rejected.push({ code: promotion.code, reason });
    };
    if (!promotion.active) { reject('INACTIVE'); continue; }
    if (promotion.startsAt && input.now < promotion.startsAt) { reject('NOT_STARTED'); continue; }
    if (promotion.endsAt && input.now > promotion.endsAt) { reject('EXPIRED'); continue; }
    if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) { reject('LIMIT_REACHED'); continue; }
    if (promotion.perCustomerLimit !== null && input.hasCustomer && (input.customerRedemptions?.get(promotion.id) ?? 0) >= promotion.perCustomerLimit) { reject('CUSTOMER_LIMIT'); continue; }
    const base = eligibleBase(promotion, input.lines);
    if (base <= 0) { reject('NOT_APPLICABLE'); continue; }
    if (base < promotion.minSubtotalCents) { reject('MIN_SUBTOTAL'); continue; }
    const discountCents = promotion.type === 'PERCENT' ? Math.round((base * promotion.value) / 100) : Math.min(Math.round(promotion.value), base);
    if (discountCents <= 0) { reject('NOT_APPLICABLE'); continue; }
    valid.push({ promotion, discountCents });
  }

  valid.sort((a, b) => b.promotion.priority - a.promotion.priority || b.discountCents - a.discountCents || a.promotion.code.localeCompare(b.promotion.code));
  const applied: PromotionResult['applied'] = [];
  let remaining = subtotal;
  for (const { promotion, discountCents } of valid) {
    const stacksWithAll = promotion.stackable && applied.every((entry) => valid.find((candidate) => candidate.promotion.id === entry.promotionId)?.promotion.stackable);
    if (applied.length > 0 && !stacksWithAll) { rejected.push({ code: promotion.code, reason: 'SUPERSEDED' }); continue; }
    const take = Math.min(discountCents, remaining);
    if (take <= 0) { rejected.push({ code: promotion.code, reason: 'NOT_APPLICABLE' }); continue; }
    applied.push({ promotionId: promotion.id, code: promotion.code, discountCents: take });
    remaining -= take;
  }
  return { applied, rejected, totalDiscountCents: applied.reduce((sum, entry) => sum + entry.discountCents, 0) };
}

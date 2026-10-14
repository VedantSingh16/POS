import { describe, expect, it } from 'vitest';
import { evaluatePromotions, resolveUnitPrice, type PriceContext, type PriceRule, type PromotionDef } from '@pos/shared/pricing';
import { gstinCheckChar, isIntraState, validateGstin } from '@pos/shared/tax-id';
import { financialYearLabel } from '@pos/shared/fiscal';

const now = new Date('2026-10-13T10:00:00Z');
const ctx: PriceContext = { storeId: 's1', variantId: 'v1', categoryId: 'c1', brandId: 'b1', customerGroup: 'General', quantity: 1, now };
const rule = (over: Partial<PriceRule>): PriceRule => ({ id: 'r', name: 'rule', priority: 0, scope: 'ALL', scopeId: null, storeId: null, customerGroup: null, minQuantity: 1, startsAt: null, endsAt: null, mode: 'FIXED', value: 5_000, ...over });

describe('price rules', () => {
  it('falls back to the base price, and reports no price when there is none', () => {
    expect(resolveUnitPrice(10_000, [], ctx)).toMatchObject({ unitPriceCents: 10_000, source: 'BASE' });
    expect(resolveUnitPrice(null, [], ctx)).toMatchObject({ unitPriceCents: null, source: 'NONE' });
  });

  it('first matching rule by priority wins, over the base price', () => {
    const low = rule({ id: 'low', priority: 1, value: 9_000 });
    const high = rule({ id: 'high', priority: 5, value: 8_000 });
    expect(resolveUnitPrice(10_000, [low, high], ctx)).toMatchObject({ unitPriceCents: 8_000, ruleId: 'high', source: 'RULE' });
  });

  it('on equal priority the more specific scope beats the general one, and a store rule beats an all-store rule', () => {
    const general = rule({ id: 'all', scope: 'ALL', value: 9_000 });
    const variant = rule({ id: 'variant', scope: 'VARIANT', scopeId: 'v1', value: 8_500 });
    expect(resolveUnitPrice(10_000, [general, variant], ctx).ruleId).toBe('variant');
    const anyStore = rule({ id: 'any', value: 9_000 });
    const thisStore = rule({ id: 'store', storeId: 's1', value: 9_100 });
    expect(resolveUnitPrice(10_000, [anyStore, thisStore], ctx).ruleId).toBe('store');
  });

  it('ignores rules for another store, customer group, scope, quantity or time window', () => {
    expect(resolveUnitPrice(10_000, [rule({ storeId: 's2' })], ctx).source).toBe('BASE');
    expect(resolveUnitPrice(10_000, [rule({ customerGroup: 'Wholesale' })], ctx).source).toBe('BASE');
    expect(resolveUnitPrice(10_000, [rule({ scope: 'CATEGORY', scopeId: 'c2' })], ctx).source).toBe('BASE');
    expect(resolveUnitPrice(10_000, [rule({ minQuantity: 10 })], ctx).source).toBe('BASE');
    expect(resolveUnitPrice(10_000, [rule({ endsAt: new Date('2026-10-01T00:00:00Z') })], ctx).source).toBe('BASE');
    expect(resolveUnitPrice(10_000, [rule({ startsAt: new Date('2026-11-01T00:00:00Z') })], ctx).source).toBe('BASE');
  });

  it('applies customer-group and quantity-tier rules', () => {
    const wholesale = rule({ id: 'w', customerGroup: 'wholesale', value: 7_000 });
    expect(resolveUnitPrice(10_000, [wholesale], { ...ctx, customerGroup: 'Wholesale' }).unitPriceCents).toBe(7_000);
    const tier = rule({ id: 't', minQuantity: 10, mode: 'PERCENT_OFF', value: 1_000 });
    expect(resolveUnitPrice(10_000, [tier], { ...ctx, quantity: 10 }).unitPriceCents).toBe(9_000);
    expect(resolveUnitPrice(10_000, [tier], { ...ctx, quantity: 9 }).unitPriceCents).toBe(10_000);
  });

  it('percent-off and amount-off need a base price and never go below zero', () => {
    expect(resolveUnitPrice(null, [rule({ mode: 'PERCENT_OFF', value: 1_000 })], ctx).source).toBe('NONE');
    expect(resolveUnitPrice(1_000, [rule({ mode: 'AMOUNT_OFF', value: 5_000 })], ctx).unitPriceCents).toBe(0);
    expect(resolveUnitPrice(null, [rule({ mode: 'FIXED', value: 2_500 })], ctx).unitPriceCents).toBe(2_500);
  });
});

const promo = (over: Partial<PromotionDef>): PromotionDef => ({ id: 'p', code: 'SAVE10', type: 'PERCENT', value: 10, minSubtotalCents: 0, usageLimit: null, usageCount: 0, perCustomerLimit: null, startsAt: null, endsAt: null, active: true, scope: 'ALL', scopeId: null, autoApply: false, priority: 0, stackable: false, ...over });
const lines = [{ variantId: 'v1', categoryId: 'c1', brandId: 'b1', netCents: 10_000 }, { variantId: 'v2', categoryId: 'c2', brandId: 'b2', netCents: 5_000 }];
const base = { lines, hasCustomer: false, now };

describe('promotions', () => {
  it('applies a valid coupon and ignores one that is not typed', () => {
    expect(evaluatePromotions({ ...base, promotions: [promo({})], couponCode: 'save10' }).totalDiscountCents).toBe(1_500);
    expect(evaluatePromotions({ ...base, promotions: [promo({})] }).applied).toEqual([]);
  });

  it('rejects unknown, expired, not-started, used-up, below-minimum and inactive coupons with a reason', () => {
    const reason = (p: Partial<PromotionDef>, extra: Partial<Parameters<typeof evaluatePromotions>[0]> = {}) =>
      evaluatePromotions({ ...base, ...extra, promotions: [promo(p)], couponCode: 'SAVE10' }).rejected[0]?.reason;
    expect(evaluatePromotions({ ...base, promotions: [], couponCode: 'NOPE' }).rejected[0]).toEqual({ code: 'NOPE', reason: 'NOT_FOUND' });
    expect(reason({ endsAt: new Date('2026-10-01T00:00:00Z') })).toBe('EXPIRED');
    expect(reason({ startsAt: new Date('2026-11-01T00:00:00Z') })).toBe('NOT_STARTED');
    expect(reason({ usageLimit: 5, usageCount: 5 })).toBe('LIMIT_REACHED');
    expect(reason({ minSubtotalCents: 50_000 })).toBe('MIN_SUBTOTAL');
    expect(reason({ active: false })).toBe('INACTIVE');
    expect(reason({ perCustomerLimit: 1 }, { hasCustomer: true, customerRedemptions: new Map([['p', 1]]) })).toBe('CUSTOMER_LIMIT');
  });

  it('limits a scoped promotion to the matching lines', () => {
    const result = evaluatePromotions({ ...base, promotions: [promo({ scope: 'CATEGORY', scopeId: 'c2', autoApply: true })] });
    expect(result.totalDiscountCents).toBe(500);
  });

  it('caps a fixed amount at the eligible value', () => {
    expect(evaluatePromotions({ ...base, promotions: [promo({ type: 'AMOUNT', value: 99_999 })], couponCode: 'SAVE10' }).totalDiscountCents).toBe(15_000);
  });

  it('two clashing promotions: the higher priority wins and the other is superseded', () => {
    const a = promo({ id: 'a', code: 'A', priority: 1, autoApply: true });
    const b = promo({ id: 'b', code: 'B', priority: 9, type: 'PERCENT', value: 5, autoApply: true });
    const result = evaluatePromotions({ ...base, promotions: [a, b] });
    expect(result.applied.map((entry) => entry.code)).toEqual(['B']);
    expect(result.rejected).toEqual([{ code: 'A', reason: 'SUPERSEDED' }]);
  });

  it('stackable promotions combine, but never beyond the subtotal', () => {
    const a = promo({ id: 'a', code: 'A', stackable: true, autoApply: true, priority: 2 });
    const b = promo({ id: 'b', code: 'B', stackable: true, autoApply: true, priority: 1, type: 'AMOUNT', value: 99_999 });
    const result = evaluatePromotions({ ...base, promotions: [a, b] });
    expect(result.applied.map((entry) => entry.code)).toEqual(['A', 'B']);
    expect(result.totalDiscountCents).toBe(15_000);
  });

  it('a non-stackable promotion does not stack even if the other one is stackable', () => {
    const a = promo({ id: 'a', code: 'A', stackable: true, autoApply: true, priority: 2 });
    const b = promo({ id: 'b', code: 'B', stackable: false, autoApply: true, priority: 1 });
    expect(evaluatePromotions({ ...base, promotions: [a, b] }).applied.map((entry) => entry.code)).toEqual(['A']);
  });
});

describe('GSTIN and place of supply', () => {
  it('accepts a correct GSTIN and rejects a wrong check character, shape or state', () => {
    expect(validateGstin('27AAPFU0939F1ZV')).toMatchObject({ valid: true, stateCode: '27' });
    expect(validateGstin(' 27aapfu0939f1zv ').valid).toBe(true);
    expect(validateGstin('27AAPFU0939F1ZX').error).toMatch(/check character/);
    expect(validateGstin('27AAPFU0939F1').error).toMatch(/15 characters/);
    expect(validateGstin('00AAPFU0939F1Z' + gstinCheckChar('00AAPFU0939F1Z')).error).toMatch(/state code/);
    expect(validateGstin('').valid).toBe(false);
  });

  it('same state or unknown buyer is intra-state; different states are IGST', () => {
    expect(isIntraState('27', '27')).toBe(true);
    expect(isIntraState('27', '')).toBe(true);
    expect(isIntraState('27', '29')).toBe(false);
  });
});

describe('financialYearLabel', () => {
  it('rolls over at midnight IST on 1 April, not at UTC midnight', () => {
    expect(financialYearLabel(new Date('2027-03-31T18:29:59Z'), 'Asia/Kolkata')).toBe('2627'); // 31 Mar 23:59:59 IST
    expect(financialYearLabel(new Date('2027-03-31T18:30:00Z'), 'Asia/Kolkata')).toBe('2728'); // 1 Apr 00:00 IST
    expect(financialYearLabel(new Date('2026-10-13T00:00:00Z'), 'Asia/Kolkata')).toBe('2627');
    expect(financialYearLabel(new Date('2026-01-01T00:00:00Z'), 'Asia/Kolkata')).toBe('2526');
  });
});

describe('currency', () => {
  it('formats and parses with each currency\'s own decimals', async () => {
    const { formatMinor, parseMinor, minorToInput, minorFactor } = await import('@pos/shared/currency');
    expect(minorFactor('OMR')).toBe(1000);
    expect(minorFactor('INR')).toBe(100);
    expect(formatMinor(49900, 'OMR')).toBe('OMR 49.900');
    expect(formatMinor(1234567, 'OMR')).toBe('OMR 1,234.567');
    expect(formatMinor(-500, 'OMR')).toBe('-OMR 0.500');
    expect(formatMinor(49900, 'INR')).toBe('₹499.00');
    expect(formatMinor(49900, undefined)).toBe('OMR 49.900'); // unknown falls back to the default
    expect(parseMinor('12.5', 'OMR')).toBe(12500);
    expect(parseMinor('12.345', 'OMR')).toBe(12345);
    expect(parseMinor('1,250.75', 'INR')).toBe(125075);
    expect(Number.isNaN(parseMinor('abc', 'OMR'))).toBe(true);
    expect(minorToInput(12500, 'OMR')).toBe('12.500');
    expect(minorToInput(12500, 'INR')).toBe('125.00');
  });
});

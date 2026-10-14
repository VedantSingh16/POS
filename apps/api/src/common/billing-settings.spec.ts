import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { applyBillingPatch, DEFAULT_BILLING_SETTINGS } from './billing-settings.js';
import type { JsonObject } from './input.js';

describe('store billing settings', () => {
  it('starts stores with independent defaults for payments and both discount levels', () => {
    expect(DEFAULT_BILLING_SETTINGS).toMatchObject({
      enabledTenders: ['CASH', 'CARD', 'UPI'],
      lineDiscountEnabled: true,
      billDiscountEnabled: true,
      lineDiscountMaxPercent: 100,
      billDiscountMaxPercent: 100,
      allowDiscountStacking: true,
    });
  });

  it('updates only supplied settings and resets null values to platform defaults', () => {
    const current = { ...DEFAULT_BILLING_SETTINGS, enabledTenders: ['CASH'], billDiscountMaxPercent: 25 } as JsonObject;
    const next = applyBillingPatch(current, { lineDiscountMaxPercent: 15, enabledTenders: null });
    expect(next).toMatchObject({ enabledTenders: ['CASH', 'CARD', 'UPI'], lineDiscountMaxPercent: 15, billDiscountMaxPercent: 25 });
  });

  it('rejects empty tender lists, invalid caps, and non-boolean switches', () => {
    const current = { ...DEFAULT_BILLING_SETTINGS } as JsonObject;
    expect(() => applyBillingPatch(current, { enabledTenders: [] })).toThrow(BadRequestException);
    expect(() => applyBillingPatch(current, { lineDiscountMaxPercent: 101 })).toThrow(/between 0 and 100/);
    expect(() => applyBillingPatch(current, { billDiscountEnabled: 'yes' })).toThrow(/true or false/);
  });
});

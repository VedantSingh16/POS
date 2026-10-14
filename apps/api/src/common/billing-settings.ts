import { BadRequestException } from '@nestjs/common';
import { TenderType } from '../generated/prisma/client.js';
import type { JsonObject } from './input.js';

/**
 * Billing settings owned by one store. Every store starts from these system defaults.
 */
export const BILLING_KEYS = ['receiptFooter', 'enabledTenders', 'cashRounding', 'requireDiscountReasonCode', 'holdTtlHours', 'pointValueCents', 'cashMovementApprovalCents', 'cashVarianceToleranceCents', 'requireBillHandler', 'lineDiscountEnabled', 'billDiscountEnabled', 'lineDiscountMaxPercent', 'billDiscountMaxPercent', 'allowDiscountStacking'] as const;
export type BillingKey = (typeof BILLING_KEYS)[number];

export const DEFAULT_BILLING_SETTINGS: Record<BillingKey, unknown> = {
  receiptFooter: '', enabledTenders: ['CASH', 'CARD', 'UPI'], cashRounding: 0,
  requireDiscountReasonCode: false, holdTtlHours: 24, pointValueCents: 1,
  cashMovementApprovalCents: 0, cashVarianceToleranceCents: 0, requireBillHandler: false,
  lineDiscountEnabled: true, billDiscountEnabled: true, lineDiscountMaxPercent: 100,
  billDiscountMaxPercent: 100, allowDiscountStacking: true,
};

const TENDERS = Object.values(TenderType) as string[];

/** Checks one billing value; returns the cleaned value. Throws a readable 400 for anything wrong. */
export function cleanBillingValue(key: BillingKey, value: unknown): unknown {
  switch (key) {
    case 'receiptFooter':
      if (typeof value !== 'string' || value.length > 300) throw new BadRequestException('receiptFooter must be text of at most 300 characters');
      return value;
    case 'enabledTenders': {
      if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string' || !TENDERS.includes(entry))) {
        throw new BadRequestException(`enabledTenders must list at least one of ${TENDERS.join(', ')}`);
      }
      return [...new Set(value as string[])];
    }
    case 'cashRounding':
      if (!Number.isInteger(value) || (value as number) < 0) throw new BadRequestException('cashRounding must be a whole number of the smallest currency unit, 0 or more');
      return value;
    case 'requireDiscountReasonCode':
    case 'requireBillHandler':
    case 'lineDiscountEnabled':
    case 'billDiscountEnabled':
    case 'allowDiscountStacking':
      if (typeof value !== 'boolean') throw new BadRequestException(`${key} must be true or false`);
      return value;
    case 'lineDiscountMaxPercent':
    case 'billDiscountMaxPercent':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new BadRequestException(`${key} must be between 0 and 100`);
      return value;
    case 'holdTtlHours':
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 720) throw new BadRequestException('holdTtlHours must be a whole number from 1 to 720');
      return value;
    case 'pointValueCents':
      if (!Number.isInteger(value) || (value as number) < 1) throw new BadRequestException('pointValueCents must be a whole number of at least 1');
      return value;
    case 'cashMovementApprovalCents':
    case 'cashVarianceToleranceCents':
      if (!Number.isInteger(value) || (value as number) < 0) throw new BadRequestException(`${key} must be a whole number of 0 or more`);
      return value;
  }
}

/** Applies a store update. Null resets the key to its platform default, never to an organization value. */
export function applyBillingPatch(current: JsonObject, patch: JsonObject): JsonObject {
  const next: JsonObject = { ...current };
  for (const key of BILLING_KEYS) {
    if (!(key in patch)) continue;
    if (patch[key] === null) next[key] = DEFAULT_BILLING_SETTINGS[key] as never;
    else next[key] = cleanBillingValue(key, patch[key]) as never;
  }
  return next;
}

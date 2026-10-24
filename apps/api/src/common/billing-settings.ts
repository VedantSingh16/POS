import { BadRequestException } from '@nestjs/common';
import { TenderType } from '../generated/prisma/client.js';
import type { JsonObject } from './input.js';

/**
 * Billing settings owned by one store. Every store starts from these system defaults.
 */
export const BILLING_KEYS = ['receiptFooter', 'enabledTenders', 'cashRounding', 'requireDiscountReasonCode', 'holdTtlHours', 'pointValueCents', 'cashMovementApprovalCents', 'cashVarianceToleranceCents', 'requireBillHandler', 'lineDiscountEnabled', 'billDiscountEnabled', 'lineDiscountMaxPercent', 'billDiscountMaxPercent', 'allowDiscountStacking', 'cashierSelection', 'cashierPinRequired', 'cashierAutoClearOnIdleLock', 'receiptHeader', 'receiptPaper', 'receiptAutoPrint', 'receiptCopies', 'receiptLanguage', 'receiptShowTaxBreakdown'] as const;
export type BillingKey = (typeof BILLING_KEYS)[number];

export const DEFAULT_BILLING_SETTINGS: Record<BillingKey, unknown> = {
  receiptFooter: '', enabledTenders: ['CASH', 'CARD', 'UPI'], cashRounding: 0,
  requireDiscountReasonCode: false, holdTtlHours: 24, pointValueCents: 1,
  cashMovementApprovalCents: 0, cashVarianceToleranceCents: 0, requireBillHandler: false,
  lineDiscountEnabled: true, billDiscountEnabled: true, lineDiscountMaxPercent: 100,
  billDiscountMaxPercent: 100, allowDiscountStacking: true,
  cashierSelection: 'STICKY', cashierPinRequired: false, cashierAutoClearOnIdleLock: true,
  receiptHeader: '', receiptPaper: '80mm', receiptAutoPrint: 'ASK', receiptCopies: 1, receiptLanguage: 'en', receiptShowTaxBreakdown: true,
};

export const RECEIPT_PAPERS = ['80mm', '58mm', 'A4'] as const;
export const RECEIPT_AUTO_PRINT = ['ASK', 'ALWAYS', 'NEVER'] as const;
export const RECEIPT_LANGUAGES = ['en', 'ar', 'both'] as const;

const TENDERS = Object.values(TenderType) as string[];

/** Checks one billing value; returns the cleaned value. Throws a readable 400 for anything wrong. */
export function cleanBillingValue(key: BillingKey, value: unknown): unknown {
  switch (key) {
    case 'receiptFooter':
      if (typeof value !== 'string' || value.length > 300) throw new BadRequestException('receiptFooter must be text of at most 300 characters');
      return value;
    case 'receiptHeader':
      if (typeof value !== 'string' || value.length > 200) throw new BadRequestException('receiptHeader must be text of at most 200 characters');
      return value;
    case 'receiptPaper':
      if (!(RECEIPT_PAPERS as readonly unknown[]).includes(value)) throw new BadRequestException(`receiptPaper must be one of ${RECEIPT_PAPERS.join(', ')}`);
      return value;
    case 'receiptAutoPrint':
      if (!(RECEIPT_AUTO_PRINT as readonly unknown[]).includes(value)) throw new BadRequestException(`receiptAutoPrint must be one of ${RECEIPT_AUTO_PRINT.join(', ')}`);
      return value;
    case 'receiptLanguage':
      if (!(RECEIPT_LANGUAGES as readonly unknown[]).includes(value)) throw new BadRequestException(`receiptLanguage must be one of ${RECEIPT_LANGUAGES.join(', ')}`);
      return value;
    case 'receiptCopies':
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 3) throw new BadRequestException('receiptCopies must be a whole number from 1 to 3');
      return value;
    case 'receiptShowTaxBreakdown':
      if (typeof value !== 'boolean') throw new BadRequestException(`${key} must be true or false`);
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
    case 'cashierPinRequired':
    case 'cashierAutoClearOnIdleLock':
      if (typeof value !== 'boolean') throw new BadRequestException(`${key} must be true or false`);
      return value;
    case 'cashierSelection':
      if (value !== 'STICKY' && value !== 'EVERY_BILL') throw new BadRequestException('cashierSelection must be STICKY or EVERY_BILL');
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

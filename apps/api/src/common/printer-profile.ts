import { BadRequestException } from '@nestjs/common';
import { RECEIPT_PAPERS } from './billing-settings.js';
import type { JsonObject } from './input.js';

export type ReceiptPaperSize = (typeof RECEIPT_PAPERS)[number];

/**
 * The receipt printer attached to one register (till). Paper follows the printer, not the store, because different
 * counters can have different printers. `setupConfirmedAt` is set when someone at the till confirmed that a test
 * receipt came out full width with no browser date or web address on it.
 */
export type PrinterProfile = {
  paper: ReceiptPaperSize | null;
  setupConfirmedAt: string | null;
  setupConfirmedBy: string | null;
};

export function readPrinterProfile(value: unknown): PrinterProfile {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as JsonObject;
  return {
    paper: (RECEIPT_PAPERS as readonly unknown[]).includes(raw.paper) ? (raw.paper as ReceiptPaperSize) : null,
    setupConfirmedAt: typeof raw.setupConfirmedAt === 'string' ? raw.setupConfirmedAt : null,
    setupConfirmedBy: typeof raw.setupConfirmedBy === 'string' ? raw.setupConfirmedBy : null,
  };
}

/**
 * Applies a change from the till. Choosing a different paper clears the confirmation, because the new printer has
 * not been checked yet. `confirmed: true` records who confirmed and when; `confirmed: false` clears it.
 */
export function applyPrinterPatch(current: PrinterProfile, patch: JsonObject, by: string, now: Date): PrinterProfile {
  const next: PrinterProfile = { ...current };
  if (patch.paper !== undefined) {
    if (!(RECEIPT_PAPERS as readonly unknown[]).includes(patch.paper)) throw new BadRequestException(`paper must be one of ${RECEIPT_PAPERS.join(', ')}`);
    if (patch.paper !== current.paper) { next.setupConfirmedAt = null; next.setupConfirmedBy = null; }
    next.paper = patch.paper as ReceiptPaperSize;
  }
  if (patch.confirmed !== undefined) {
    if (typeof patch.confirmed !== 'boolean') throw new BadRequestException('confirmed must be true or false');
    if (patch.confirmed && !next.paper) throw new BadRequestException('Choose the paper size before confirming the printer');
    next.setupConfirmedAt = patch.confirmed ? now.toISOString() : null;
    next.setupConfirmedBy = patch.confirmed ? by : null;
  }
  return next;
}

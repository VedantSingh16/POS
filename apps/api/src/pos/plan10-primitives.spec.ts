import { describe, expect, it } from 'vitest';
import { PosService } from './pos.service.js';
import { buildReportPdf } from './report-pdf.js';

const internals = Object.create(PosService.prototype) as {
  localDayBounds(date: string, timeZone: string): { from: Date; to: Date };
  approvalPayloadHash(action: string, storeId: string, referenceId: string, payload: Record<string, unknown>): string;
};

describe('Plan 10 operational primitives', () => {
  it('uses the store timezone and handles a daylight-saving day boundary', () => {
    const bounds = internals.localDayBounds('2026-03-08', 'America/New_York');
    expect(bounds.from.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(bounds.to.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(bounds.to.getTime() - bounds.from.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('canonicalizes approval payloads while binding action, store, and reference', () => {
    const first = internals.approvalPayloadHash('CASH_MOVEMENT', 'store-a', 'session-a', { type: 'PAID_OUT', amountCents: 500, metadata: { reason: 'Expense', source: 'till' } });
    const reordered = internals.approvalPayloadHash('CASH_MOVEMENT', 'store-a', 'session-a', { metadata: { source: 'till', reason: 'Expense' }, amountCents: 500, type: 'PAID_OUT' });
    expect(first).toBe(reordered);
    expect(first).not.toBe(internals.approvalPayloadHash('CASH_MOVEMENT', 'store-b', 'session-a', { type: 'PAID_OUT', amountCents: 500, metadata: { reason: 'Expense', source: 'till' } }));
    expect(first).not.toBe(internals.approvalPayloadHash('CASH_MOVEMENT', 'store-a', 'session-a', { type: 'PAID_OUT', amountCents: 501, metadata: { reason: 'Expense', source: 'till' } }));
  });

  it('creates a valid multi-page PDF export', () => {
    const pdf = buildReportPdf('Store report', Array.from({ length: 75 }, (_, index) => `Report row ${index + 1}`));
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text.endsWith('%%EOF\n')).toBe(true);
  });
});

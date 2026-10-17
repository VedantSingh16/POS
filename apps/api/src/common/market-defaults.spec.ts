import { describe, expect, it } from 'vitest';
import { cleanFieldSet } from './field-config.js';
import { validateOmanAddress } from '@pos/shared/address-formats';
import { validateOmanVatNumber } from '@pos/shared/tax-id';
import { financialYearLabel } from '@pos/shared/fiscal';
import { taxRegimeFor } from '@pos/shared/markets';

describe('configurable market defaults', () => {
  it('starts new catalogues without brand but keeps essential fields locked', () => {
    const initial = cleanFieldSet(undefined);
    expect(initial.coreFields).not.toContain('brand');
    expect(initial.coreFields).toContain('category');
    const configured = cleanFieldSet({ version: 1, fields: [], coreFields: ['brand'] });
    for (const field of ['name', 'category', 'sku', 'price', 'uom', 'status']) expect(configured.coreFields).toContain(field);
    expect(configured.coreFields).toContain('brand');
  });

  it('uses country suggestions without assigning VAT to every market', () => {
    expect(taxRegimeFor('OM')).toBe('VAT');
    expect(taxRegimeFor('IN')).toBe('GST');
    expect(taxRegimeFor('US')).toBe('TAX');
  });

  it('accepts a free-text Omani locality and validates an optional postal code', () => {
    const details = { governorate: 'Muscat', wilayat: 'New locality', area: 'New area', postalCode: '133' };
    expect(validateOmanAddress(details).valid).toBe(true);
    expect(validateOmanAddress({ ...details, postalCode: '12' }).errors.postalCode).toBeTruthy();
  });

  it('accepts the stated VATIN shape and uses calendar years outside India', () => {
    expect(validateOmanVatNumber('OM1234567890').valid).toBe(true);
    expect(validateOmanVatNumber('OM123').valid).toBe(false);
    expect(financialYearLabel(new Date('2026-01-01T00:00:00Z'), 'Asia/Muscat', 'OM')).toBe('2026');
    expect(financialYearLabel(new Date('2026-01-01T00:00:00Z'), 'Asia/Kolkata', 'IN')).toBe('2526');
  });
});

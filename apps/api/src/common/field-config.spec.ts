import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { cleanFieldSet, cleanFieldValues, cleanStoreFieldSet } from './field-config.js';

const field = (overrides: Record<string, unknown> = {}) => ({
  key: 'material', label: 'Material', type: 'TEXT', required: false, active: true, order: 0,
  helpText: '', options: [], storeEditable: false, showOnReceipt: false, showInList: false,
  level: 'PRODUCT', ...overrides,
});

describe('configurable field definitions', () => {
  it('sorts definitions and always keeps the product identity fields visible', () => {
    const config = cleanFieldSet({
      fields: [field({ key: 'size', label: 'Size', order: 20 }), field({ key: 'material', order: 2 })],
      coreFields: ['category'],
    });
    expect(config.fields.map((item) => item.key)).toEqual(['material', 'size']);
    expect(config.coreFields).toEqual(['category', 'name', 'sku', 'price']);
  });

  it('rejects malformed definitions and unsupported store controls', () => {
    expect(() => cleanFieldSet({ fields: [field({ key: 'Material' })] })).toThrow(BadRequestException);
    expect(() => cleanFieldSet({ fields: [field({ level: 'SALE' })] })).toThrow(/PRODUCT or VARIANT/);
    expect(() => cleanFieldSet({ fields: [field({ required: 'yes' })] })).toThrow(/required.*true or false/);
    expect(() => cleanFieldSet({ fields: [], allowStoreFields: 'yes' })).toThrow(/allowStoreFields/);
  });

  it('keeps product schemas organization-owned and rejects store overrides or local fields', () => {
    const organization = cleanFieldSet({ allowStoreFields: true, coreFields: ['brand', 'category'], fields: [field({ storeEditable: true })] });
    expect(organization.allowStoreFields).toBe(false);
    expect(organization.fields[0]?.storeEditable).toBe(false);
    expect(() => cleanStoreFieldSet({ overrides: { material: { label: 'Store material' } } }, organization)).toThrow(/owned by the organisation/);
    expect(() => cleanStoreFieldSet({ fields: [field({ key: 'local_note' })] }, organization)).toThrow(/owned by the organisation/);
    expect(() => cleanStoreFieldSet({ coreFields: ['name', 'sku', 'price'] }, organization)).toThrow(/owned by the organisation/);
  });

  it('supports store-owned checkout fields and standard controls', () => {
    const checkout = cleanFieldSet({ allowStoreFields: true, fields: [field({ key: 'gift_note', level: 'PRODUCT' })], coreFields: ['customer', 'coupon', 'discount'] }, 'CHECKOUT');
    expect(checkout.allowStoreFields).toBe(true);
    expect(checkout.fields.map((item) => item.key)).toEqual(['gift_note']);
    expect(checkout.coreFields).toContain('discount');
    expect(() => cleanFieldSet({ fields: [], coreFields: ['sku'] }, 'CHECKOUT')).toThrow(/checkout field keys/);
  });
});

describe('configurable field values', () => {
  it('applies typed defaults when fields are omitted and validates those defaults', () => {
    const definitions = cleanFieldSet({ fields: [
      field({ key: 'material', defaultValue: '  cotton  ' }),
      field({ key: 'weight', type: 'NUMBER', min: 0, max: 10, defaultValue: 2.5 }),
      field({ key: 'organic', type: 'YESNO', defaultValue: false }),
    ] }).fields;
    expect(cleanFieldValues(definitions, {})).toEqual({ material: 'cotton', weight: 2.5, organic: false });
    expect(() => cleanFieldSet({ fields: [field({ type: 'SELECT', options: ['A', 'B'], defaultValue: 'C' })] })).toThrow(/configured options/);
    expect(() => cleanFieldSet({ fields: [field({ defaultValue: '   ' })] })).toThrow(/must not be empty/);
  });

  it('validates and normalizes required text, numeric bounds, dates, booleans and select options', () => {
    const definitions = cleanFieldSet({ fields: [
      field({ key: 'material', required: true }),
      field({ key: 'weight', type: 'NUMBER', min: 0.1, max: 50 }),
      field({ key: 'best_before', type: 'DATE' }),
      field({ key: 'organic', type: 'YESNO' }),
      field({ key: 'grade', type: 'SELECT', options: ['A', 'B'] }),
    ] }).fields;
    expect(cleanFieldValues(definitions, { material: '  cotton  ', weight: 2.5, best_before: '2026-02-28', organic: false, grade: 'A' })).toEqual({
      material: 'cotton', weight: 2.5, best_before: '2026-02-28', organic: false, grade: 'A',
    });
  });

  it('rejects missing required values, unknown keys, invalid types, bounds, options and impossible dates', () => {
    const definitions = cleanFieldSet({ fields: [
      field({ key: 'material', required: true }),
      field({ key: 'weight', label: 'Weight', type: 'NUMBER', min: 1, max: 10 }),
      field({ key: 'best_before', type: 'DATE' }),
      field({ key: 'grade', type: 'SELECT', options: ['A', 'B'] }),
    ] }).fields;
    expect(() => cleanFieldValues(definitions, {})).toThrow(/Material is required/);
    expect(() => cleanFieldValues(definitions, { material: 'cotton', other: 'x' })).toThrow(/Unknown custom field/);
    expect(() => cleanFieldValues(definitions, { material: 'cotton', weight: 0 })).toThrow(/Weight must be a valid number/);
    expect(() => cleanFieldValues(definitions, { material: 'cotton', best_before: '2026-02-31' })).toThrow(/YYYY-MM-DD/);
    expect(() => cleanFieldValues(definitions, { material: 'cotton', grade: 'C' })).toThrow(/configured options/);
  });

  it('retains disabled or archived values when callers request unknown-field preservation', () => {
    const definitions = cleanFieldSet({ fields: [field({ active: false })] }).fields;
    expect(cleanFieldValues(definitions, { old_key: 'kept', material: 'old value' }, { preserveUnknown: true })).toEqual({ old_key: 'kept', material: 'old value' });
  });
});

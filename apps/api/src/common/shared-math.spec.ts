import { describe, expect, it } from 'vitest';
import { splitGst, splitInclusive, taxOnExclusive } from '@pos/shared/gst';

describe('shared GST maths', () => {
  it('calculates tax-exclusive GST in paise', () => {
    expect(taxOnExclusive(10_000, 1_800)).toBe(1_800);
  });

  it('splits an inclusive amount without losing a paise', () => {
    expect(splitInclusive(11_800, 1_800)).toEqual({ net: 10_000, tax: 1_800 });
  });

  it('splits intra-state tax and keeps interstate tax as IGST', () => {
    expect(splitGst(1_801, true)).toEqual({ cgst: 900, sgst: 901, igst: 0, total: 1_801 });
    expect(splitGst(1_801, false)).toEqual({ cgst: 0, sgst: 0, igst: 1_801, total: 1_801 });
  });
});

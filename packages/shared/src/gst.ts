import { paise, type Paise } from './money.js';

export type GstSplit = { cgst: Paise; sgst: Paise; igst: Paise; total: Paise };

/** Tax for a tax-exclusive amount. rateBps is basis points: GST 18% is 1800. */
export function taxOnExclusive(amountPaise: number, rateBps: number): Paise {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new Error('Amount must be a non-negative integer in paise');
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new Error('GST rate must be a non-negative integer in basis points');
  return paise(Math.round((amountPaise * rateBps) / 10_000));
}

/** Returns the net and tax portions of a tax-inclusive amount. */
export function splitInclusive(amountPaise: number, rateBps: number): { net: Paise; tax: Paise } {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new Error('Amount must be a non-negative integer in paise');
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new Error('GST rate must be a non-negative integer in basis points');
  const net = rateBps === 0 ? amountPaise : Math.round((amountPaise * 10_000) / (10_000 + rateBps));
  return { net: paise(net), tax: paise(amountPaise - net) };
}

export function splitGst(taxPaise: number, intraState: boolean): GstSplit {
  const total = paise(taxPaise);
  if (!intraState) return { cgst: paise(0), sgst: paise(0), igst: total, total };
  const cgst = paise(Math.floor(taxPaise / 2));
  const sgst = paise(taxPaise - cgst);
  return { cgst, sgst, igst: paise(0), total };
}

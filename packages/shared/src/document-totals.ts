/**
 * Totals block for printed sale documents (till receipt and A4 tax invoice).
 *
 * How a sale is stored:
 * - each line's `lineTotalCents` = net + tax after its own line discount (`taxCents` is the line's tax);
 * - `subtotalCents` = sum of line nets, before the whole-bill discount and before tax;
 * - `discountCents` = line discounts + whole-bill discount (offers, coupons, manual);
 * - `taxCents` = item tax after the bill discount + tax on charges;
 * - `totalCents` = subtotal − bill discount + tax + charges + rounding.
 *
 * Printing `subtotal` and then the full `discountCents` under it double-counts line discounts
 * (0.840 − 2.760 + 0.042 ≠ 0.882). This module derives every row so the block always adds up to the stored total.
 */

export type DocumentLine = { quantity: number; unitPriceCents: number; discountCents: number; taxRateBps: number; taxCents: number; lineTotalCents: number };
export type DocumentCharge = { amountCents: number; taxCents: number; taxRateBps: number };
export type DocumentSale = { lines: DocumentLine[]; charges: DocumentCharge[]; taxCents: number; roundingCents: number; totalCents: number };

/** INCL: prices were entered with VAT included, so lines and the items total are shown with VAT. EXCL: shown before VAT. */
export type PriceBasis = 'INCL' | 'EXCL';
export type TotalsRowKey = 'itemsInclTax' | 'subtotalExclTax' | 'billDiscount' | 'charges' | 'tax' | 'rounding' | 'total' | 'totalExclTax' | 'taxIncluded';
export type TotalsRow = { key: TotalsRowKey; amountCents: number; taxRateBps?: number };
export type RateSummary = { taxRateBps: number; taxableCents: number; taxCents: number };

export type DocumentTotals = {
  basis: PriceBasis;
  /** Amount shown on each line, in the same basis as the totals block. */
  lineAmounts: number[];
  /** Line net amounts (before VAT, after line discount). */
  lineNets: number[];
  itemsNetCents: number;
  itemsGrossCents: number;
  lineDiscountCents: number;
  /** Whole-bill discount in the document's basis. */
  billDiscountCents: number;
  /** Whole-bill discount before VAT (what the tax invoice shows). */
  billDiscountNetCents: number;
  chargesNetCents: number;
  chargesTaxCents: number;
  /** Rows to print, in order. Every row up to and including `total` adds up. Rows after `total` are information only. */
  rows: TotalsRow[];
  /** Tax by rate after the bill discount. Taxable and tax add up to the document's figures. */
  byRate: RateSummary[];
  /** Line discounts + bill discount, for "You saved". */
  savedCents: number;
};

/** Splits `total` across `weights` in whole units, so the parts add up exactly (largest remainder). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, index) => (index === 0 ? total : 0));
  const raw = weights.map((weight) => (total * weight) / sum);
  const parts = raw.map((value) => Math.floor(value));
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (let i = 0; left > 0 && i < order.length; i += 1, left -= 1) parts[order[i]!.index]! += 1;
  return parts;
}

/** A line was priced with tax included when quantity × price − discount equals the line total (within rounding). */
function lineIncludesTax(line: DocumentLine): boolean | null {
  if (line.taxCents === 0) return null;
  const discounted = Math.round(line.unitPriceCents * line.quantity) - line.discountCents;
  if (Math.abs(discounted - line.lineTotalCents) <= 1) return true;
  if (Math.abs(discounted - (line.lineTotalCents - line.taxCents)) <= 1) return false;
  return null;
}

export function documentTotals(sale: DocumentSale): DocumentTotals {
  const lineNets = sale.lines.map((line) => line.lineTotalCents - line.taxCents);
  const itemsNetCents = lineNets.reduce((a, b) => a + b, 0);
  const itemsGrossCents = sale.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const lineDiscountCents = sale.lines.reduce((sum, line) => sum + line.discountCents, 0);
  const chargesNetCents = sale.charges.reduce((sum, charge) => sum + (charge.amountCents ?? 0), 0);
  const chargesTaxCents = sale.charges.reduce((sum, charge) => sum + (charge.taxCents ?? 0), 0);

  const verdicts = sale.lines.map(lineIncludesTax).filter((value): value is boolean => value !== null);
  const basis: PriceBasis = verdicts.length > 0 && verdicts.every(Boolean) ? 'INCL' : 'EXCL';

  // Derived from the stored total so the block always adds up, whatever rounding happened at sale time.
  const billDiscountNetCents = Math.max(0, itemsNetCents + chargesNetCents + sale.taxCents + sale.roundingCents - sale.totalCents);
  const billDiscountInclCents = Math.max(0, itemsGrossCents + chargesNetCents + chargesTaxCents + sale.roundingCents - sale.totalCents);

  // Tax by rate after the bill discount: the discount and the remaining item tax are shared across rates.
  const itemTaxAfterDiscount = sale.taxCents - chargesTaxCents;
  const rateKeys = [...new Set(sale.lines.map((line) => line.taxRateBps))].sort((a, b) => a - b);
  const netByRate = rateKeys.map((rate) => sale.lines.reduce((sum, line, index) => sum + (line.taxRateBps === rate ? lineNets[index]! : 0), 0));
  const taxByRate = rateKeys.map((rate) => sale.lines.reduce((sum, line) => sum + (line.taxRateBps === rate ? line.taxCents : 0), 0));
  const discountShare = allocate(billDiscountNetCents, netByRate);
  const taxShare = allocate(itemTaxAfterDiscount, taxByRate);
  const byRateMap = new Map<number, RateSummary>();
  rateKeys.forEach((rate, index) => byRateMap.set(rate, { taxRateBps: rate, taxableCents: netByRate[index]! - discountShare[index]!, taxCents: taxShare[index]! }));
  for (const charge of sale.charges) {
    const entry = byRateMap.get(charge.taxRateBps) ?? { taxRateBps: charge.taxRateBps, taxableCents: 0, taxCents: 0 };
    entry.taxableCents += charge.amountCents ?? 0;
    entry.taxCents += charge.taxCents ?? 0;
    byRateMap.set(charge.taxRateBps, entry);
  }
  const byRate = [...byRateMap.values()].filter((entry) => entry.taxRateBps > 0 || entry.taxCents > 0).sort((a, b) => a.taxRateBps - b.taxRateBps);

  const rows: TotalsRow[] = [];
  if (basis === 'INCL') {
    rows.push({ key: 'itemsInclTax', amountCents: itemsGrossCents });
    if (billDiscountInclCents > 0) rows.push({ key: 'billDiscount', amountCents: -billDiscountInclCents });
    if (sale.charges.length) rows.push({ key: 'charges', amountCents: chargesNetCents + chargesTaxCents });
    if (sale.roundingCents) rows.push({ key: 'rounding', amountCents: sale.roundingCents });
    rows.push({ key: 'total', amountCents: sale.totalCents });
    rows.push({ key: 'totalExclTax', amountCents: sale.totalCents - sale.roundingCents - sale.taxCents });
    rows.push({ key: 'taxIncluded', amountCents: sale.taxCents });
  } else {
    rows.push({ key: 'subtotalExclTax', amountCents: itemsNetCents });
    if (billDiscountNetCents > 0) rows.push({ key: 'billDiscount', amountCents: -billDiscountNetCents });
    if (sale.charges.length) rows.push({ key: 'charges', amountCents: chargesNetCents });
    rows.push({ key: 'tax', amountCents: sale.taxCents });
    if (sale.roundingCents) rows.push({ key: 'rounding', amountCents: sale.roundingCents });
    rows.push({ key: 'total', amountCents: sale.totalCents });
  }

  return {
    basis,
    lineAmounts: basis === 'INCL' ? sale.lines.map((line) => line.lineTotalCents) : lineNets,
    lineNets,
    itemsNetCents,
    itemsGrossCents,
    lineDiscountCents,
    billDiscountCents: basis === 'INCL' ? billDiscountInclCents : billDiscountNetCents,
    billDiscountNetCents,
    chargesNetCents,
    chargesTaxCents,
    rows,
    byRate,
    savedCents: lineDiscountCents + (basis === 'INCL' ? billDiscountInclCents : billDiscountNetCents),
  };
}

/** Sum of the rows up to and including `total`, except `total` itself. Equal to the total when the block adds up. */
export function rowsBeforeTotal(rows: TotalsRow[]): number {
  const end = rows.findIndex((row) => row.key === 'total');
  return rows.slice(0, end).reduce((sum, row) => sum + row.amountCents, 0);
}

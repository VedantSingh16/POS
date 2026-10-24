import { allocate, documentTotals, rowsBeforeTotal, type DocumentLine } from '@pos/shared/document-totals';

const line = (unitPriceCents: number, quantity: number, discountCents: number, taxRateBps: number, taxCents: number, lineTotalCents: number): DocumentLine =>
  ({ unitPriceCents, quantity, discountCents, taxRateBps, taxCents, lineTotalCents });

describe('documentTotals', () => {
  it('fixes the Golden Crust bill: line discounts are not taken off the subtotal a second time', () => {
    // Cheesecake 2.800 with 70% off (−1.960) + 5% VAT; baguette 0.800 with 100% off. Stored: subtotal 0.840, discount 2.760, VAT 0.042, total 0.882.
    const totals = documentTotals({ lines: [line(2800, 1, 1960, 500, 42, 882), line(800, 1, 800, 0, 0, 0)], charges: [], taxCents: 42, roundingCents: 0, totalCents: 882 });
    expect(totals.basis).toBe('EXCL');
    expect(totals.lineAmounts).toEqual([840, 0]);
    expect(totals.rows).toEqual([{ key: 'subtotalExclTax', amountCents: 840 }, { key: 'tax', amountCents: 42 }, { key: 'total', amountCents: 882 }]);
    expect(rowsBeforeTotal(totals.rows)).toBe(882);
    expect(totals.savedCents).toBe(2760);
    expect(totals.byRate).toEqual([{ taxRateBps: 500, taxableCents: 840, taxCents: 42 }]);
  });

  it('shows VAT-inclusive prices with VAT included, and the VAT inside the total', () => {
    const totals = documentTotals({ lines: [line(49900, 2, 0, 500, 4752, 99800)], charges: [], taxCents: 4752, roundingCents: 0, totalCents: 99800 });
    expect(totals.basis).toBe('INCL');
    expect(totals.lineAmounts).toEqual([99800]);
    expect(totals.rows).toEqual([
      { key: 'itemsInclTax', amountCents: 99800 },
      { key: 'total', amountCents: 99800 },
      { key: 'totalExclTax', amountCents: 95048 },
      { key: 'taxIncluded', amountCents: 4752 },
    ]);
  });

  it('adds up with a whole-bill discount, a charge and two VAT rates (prices before VAT)', () => {
    // A: 2 × 10.00 at 5% = 20.00 + 1.00; B: 10.00 at 0%. Bill discount 10% (3.00) cuts item VAT to 0.90. Charge 5.00 + 0.25 VAT.
    const sale = { lines: [line(1000, 2, 0, 500, 100, 2100), line(1000, 1, 0, 0, 0, 1000)], charges: [{ amountCents: 500, taxCents: 25, taxRateBps: 500 }], taxCents: 115, roundingCents: 0, totalCents: 3315 };
    const totals = documentTotals(sale);
    expect(totals.basis).toBe('EXCL');
    expect(totals.rows.map((row) => [row.key, row.amountCents])).toEqual([['subtotalExclTax', 3000], ['billDiscount', -300], ['charges', 500], ['tax', 115], ['total', 3315]]);
    expect(rowsBeforeTotal(totals.rows)).toBe(3315);
    expect(totals.byRate).toEqual([{ taxRateBps: 500, taxableCents: 2300, taxCents: 115 }]);
    const taxable = totals.byRate.reduce((sum, entry) => sum + entry.taxableCents, 0) + 900; // the 0% part after its share of the discount
    expect(taxable).toBe(sale.totalCents - sale.taxCents);
  });

  it('adds up with VAT-inclusive prices, a bill discount and cash rounding', () => {
    // 10.50 incl. 5% VAT (net 10.00); bill discount 1.00 net; VAT 0.45; 9.45 rounded to 9.50.
    const totals = documentTotals({ lines: [line(1050, 1, 0, 500, 50, 1050)], charges: [], taxCents: 45, roundingCents: 5, totalCents: 950 });
    expect(totals.basis).toBe('INCL');
    expect(totals.rows.map((row) => [row.key, row.amountCents])).toEqual([['itemsInclTax', 1050], ['billDiscount', -105], ['rounding', 5], ['total', 950], ['totalExclTax', 900], ['taxIncluded', 45]]);
    expect(rowsBeforeTotal(totals.rows)).toBe(950);
    expect(totals.byRate).toEqual([{ taxRateBps: 500, taxableCents: 900, taxCents: 45 }]);
  });

  it('treats a sale with no VAT as prices before VAT', () => {
    const totals = documentTotals({ lines: [line(500, 3, 0, 0, 0, 1500)], charges: [], taxCents: 0, roundingCents: 0, totalCents: 1500 });
    expect(totals.basis).toBe('EXCL');
    expect(totals.byRate).toEqual([]);
    expect(rowsBeforeTotal(totals.rows)).toBe(1500);
  });

  it('splits whole units exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(7, [0, 0])).toEqual([7, 0]);
    expect(allocate(10, [3, 7]).reduce((a, b) => a + b, 0)).toBe(10);
  });
});

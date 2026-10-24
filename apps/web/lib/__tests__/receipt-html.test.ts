import { describe, expect, it } from "vitest";
import { escapeHtml, receiptHtml, sampleReceipt, type ReceiptData } from "@/features/sales/receipt-html";

const settings: ReceiptData["settings"] = { paper: "80mm", autoPrint: "ASK", language: "en", copies: 1, showTaxBreakdown: true };
const base = () => ({
  ...sampleReceipt({ name: "DELT Store 2", address: "Muscat", taxNumber: "OM1100000000", currency: "OMR", decimals: 3 }, settings, { header: "Tel 2400 0000", footer: "Thank you for shopping" }),
  receiptNumber: "S2-000123",
  cashier: "Sayed",
});

describe("receiptHtml", () => {
  it("lays out an 80 mm receipt with store header, lines, totals, tenders and change", () => {
    const html = receiptHtml(base());
    expect(html).toContain("@page { size: 80mm 297mm; margin: 0; }");
    expect(html).toContain(`<body data-roll="80mm">`);
    expect(html).toContain("width: 72mm");
    expect(html).toContain("DELT Store 2");
    expect(html).toContain("Tax no.: OM1100000000");
    expect(html).toContain("Tel 2400 0000");
    expect(html).toContain("S2-000123");
    expect(html).toContain("Sayed");
    expect(html).toContain("OMR 5.250"); // total
    expect(html).toContain("OMR 10.000"); // tendered
    expect(html).toContain("OMR 4.750"); // change
    expect(html).toContain("VAT 5%");
    expect(html).toContain("Thank you for shopping");
    expect(html).not.toContain("REPRINT");
  });

  it("prints the Golden Crust bill with totals that add up (line discounts are not taken off twice)", () => {
    // Cheesecake 2.800 with −1.960 + 5% VAT, baguette 0.800 with −0.800. Stored: subtotal 0.840, discount 2.760, VAT 0.042, total 0.882.
    const html = receiptHtml({
      ...base(),
      lines: [
        { name: "Cheesecake Slice · Standard", sku: "CS", quantity: 1, unitPriceCents: 2800, discountCents: 1960, taxRateBps: 500, taxCents: 42, lineTotalCents: 882 },
        { name: "French Baguette · Standard", sku: "FB", quantity: 1, unitPriceCents: 800, discountCents: 800, taxRateBps: 0, taxCents: 0, lineTotalCents: 0 },
      ],
      subtotalCents: 840, discountCents: 2760, taxCents: 42, roundingCents: 0, totalCents: 882, charges: [],
      payments: [{ tenderType: "CASH", amountCents: 882, tenderedCents: null, changeCents: 0, reference: "" }], changeCents: 0,
    });
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("1 × OMR 2.800 (−OMR 1.960) OMR 0.840"); // line amount before VAT, same basis as the subtotal
    expect(text).toContain("Subtotal (excl. VAT) OMR 0.840");
    expect(text).toContain("VAT OMR 0.042");
    expect(text).toContain("TOTAL OMR 0.882");
    expect(text).toContain("You saved OMR 2.760");
    expect(text).not.toContain("Discount −OMR 2.760");
    expect(text).not.toContain("Bill discount");
  });

  it("shows VAT-inclusive prices as VAT-inclusive, with a bill discount that adds up", () => {
    // 10.500 incl. 5% VAT, 1.000 bill discount before VAT → VAT 0.450, total 9.450.
    const html = receiptHtml({
      ...base(),
      lines: [{ name: "Cake", sku: "C", quantity: 1, unitPriceCents: 10500, discountCents: 0, taxRateBps: 500, taxCents: 500, lineTotalCents: 10500 }],
      subtotalCents: 10000, discountCents: 1000, taxCents: 450, roundingCents: 0, totalCents: 9450, charges: [],
      payments: [{ tenderType: "CARD", amountCents: 9450, tenderedCents: null, changeCents: 0, reference: "" }], changeCents: 0,
    });
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("1 × OMR 10.500 OMR 10.500");
    expect(text).toContain("Items total (incl. VAT) OMR 10.500");
    expect(text).toContain("Bill discount −OMR 1.050");
    expect(text).toContain("TOTAL OMR 9.450");
    expect(text).toContain("VAT included OMR 0.450");
    expect(text).toContain("VAT 5% · Taxable OMR 9.000 OMR 0.450");
  });

  it("marks reprints and extra copies, and separates copies with a page cut", () => {
    const reprint = receiptHtml({ ...base(), isReprint: true });
    expect(reprint).toContain("REPRINT");
    const copies = receiptHtml(base(), { copies: 2 });
    expect(copies.match(/<section class="receipt">/g)).toHaveLength(2);
    expect(copies.match(/REPRINT/g)).toHaveLength(1); // only the second copy
    expect(copies).toContain('class="cut"');
  });

  it("supports 58 mm and A4 paper", () => {
    expect(receiptHtml(base(), { paper: "58mm" })).toContain("width: 48mm");
    expect(receiptHtml(base(), { paper: "A4" })).toContain("@page { size: A4; margin: 12mm; }");
  });

  it("prints Arabic labels right to left, and both languages when asked", () => {
    const ar = receiptHtml(base(), { language: "ar" });
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(ar).toContain("الإجمالي");
    const both = receiptHtml(base(), { language: "both" });
    expect(both).toContain("TOTAL");
    expect(both).toContain("الإجمالي");
  });

  it("hides the tax summary when switched off", () => {
    const html = receiptHtml({ ...base(), settings: { ...settings, showTaxBreakdown: false } });
    expect(html).not.toContain("Tax summary");
  });

  it("escapes text that came from users", () => {
    const html = receiptHtml({ ...base(), footer: '<script>alert("x")</script>', lines: [{ ...base().lines[0]!, name: "<img src=x onerror=1>" }] });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml(`a&b"'`)).toBe("a&amp;b&quot;&#39;");
  });

  it("labels a test print", () => {
    expect(receiptHtml(base(), { test: true })).toContain("TEST PRINT");
  });
});

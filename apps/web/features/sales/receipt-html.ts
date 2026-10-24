import { formatMinor } from "@pos/shared/currency";
import { documentTotals, type TotalsRow } from "@pos/shared/document-totals";

/** Receipt data as returned by `GET /pos/v1/sales/:saleId/receipt`. */
export type ReceiptPaper = "80mm" | "58mm" | "A4";
export type ReceiptLanguage = "en" | "ar" | "both";
export type ReceiptData = {
  saleId: string;
  storeId: string;
  receiptNumber: string;
  issuedAt: string;
  timezone: string;
  status: string;
  currency: { code: string; symbol: string; decimals: number };
  taxRegime: "GST" | "VAT" | "TAX";
  seller: { name: string; address: string; gstin: string; storeName: string; storeCode: string; storeAddress: string };
  header: string;
  footer: string;
  customer: { name: string; phone: string } | null;
  buyer: { legalName: string; taxNumber: string; address: string; isBusiness: boolean } | null;
  cashier: string;
  register: string;
  customFields: { label: string; value: string }[];
  lines: { name: string; sku: string; quantity: number; unitPriceCents: number; discountCents: number; taxRateBps: number; taxCents: number; lineTotalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  charges: { name: string; amountCents: number; taxCents: number; taxRateBps: number }[];
  taxCents: number;
  roundingCents: number;
  totalCents: number;
  taxBreakdown: { taxRateBps: number; taxableCents: number; taxCents: number }[];
  payments: { tenderType: string; amountCents: number; tenderedCents: number | null; changeCents: number; reference: string }[];
  changeCents: number;
  printCount: number;
  isReprint: boolean;
  settings: { paper: ReceiptPaper; autoPrint: "ASK" | "ALWAYS" | "NEVER"; language: ReceiptLanguage; copies: number; showTaxBreakdown: boolean };
};

export type ReceiptOptions = { paper?: ReceiptPaper; copies?: number; language?: ReceiptLanguage; reprint?: boolean; test?: boolean };

const LABELS = {
  taxInvoice: ["Tax invoice", "فاتورة ضريبية"],
  receipt: ["Receipt", "إيصال"],
  receiptNo: ["Receipt no.", "رقم الإيصال"],
  date: ["Date", "التاريخ"],
  register: ["Register", "الصندوق"],
  cashier: ["Cashier", "الكاشير"],
  customer: ["Customer", "العميل"],
  taxNo: ["Tax no.", "الرقم الضريبي"],
  item: ["Item", "الصنف"],
  amount: ["Amount", "المبلغ"],
  billDiscount: ["Bill discount", "خصم الفاتورة"],
  saved: ["You saved", "وفّرت"],
  tax: ["Tax", "الضريبة"],
  rounding: ["Rounding", "التقريب"],
  total: ["TOTAL", "الإجمالي"],
  paid: ["Paid", "المدفوع"],
  tendered: ["Tendered", "المبلغ المستلم"],
  change: ["Change", "الباقي"],
  taxSummary: ["Tax summary", "ملخص الضريبة"],
  taxable: ["Taxable", "الخاضع"],
  reprint: ["REPRINT", "نسخة مكررة"],
  thanks: ["Thank you", "شكراً لزيارتكم"],
  items: ["Items", "عدد الأصناف"],
  test: ["TEST PRINT – NOT A SALE", "طباعة تجريبية – ليست عملية بيع"],
  voided: ["VOIDED", "ملغاة"],
} as const;
const TENDERS: Record<string, [string, string]> = {
  CASH: ["Cash", "نقداً"], CARD: ["Card", "بطاقة"], UPI: ["UPI / QR", "رمز QR"], WALLET: ["Wallet", "المحفظة"], POINTS: ["Points", "النقاط"], OTHER: ["Other", "أخرى"],
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function label(key: keyof typeof LABELS | [string, string], language: ReceiptLanguage, taxName?: string): string {
  const [en, ar] = Array.isArray(key) ? key : LABELS[key];
  const enText = taxName && key === "tax" ? taxName : en;
  const arText = taxName === "VAT" && key === "tax" ? "ضريبة القيمة المضافة" : ar;
  if (language === "ar") return `<span dir="rtl">${escapeHtml(arText)}</span>`;
  if (language === "both") return `${escapeHtml(enText)} <span class="ar" dir="rtl">${escapeHtml(arText)}</span>`;
  return escapeHtml(enText);
}

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
const qty = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, ""));

function dateText(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timeZone || undefined }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString("en-GB");
  }
}

/** Content width on the paper. Thermal printers cannot print the last ~4 mm on each side of the roll. */
/** A4 uses most of the sheet width, so an A4 printout is a readable page rather than a narrow strip in the middle. */
const WIDTH: Record<ReceiptPaper, string> = { "80mm": "72mm", "58mm": "48mm", A4: "180mm" };

function receiptBody(data: ReceiptData, language: ReceiptLanguage, reprint: boolean, test: boolean): string {
  const money = (minor: number) => formatMinor(minor, data.currency.code);
  const taxName = data.taxRegime === "GST" ? "GST" : data.taxRegime === "VAT" ? "VAT" : "Tax";
  const row = (left: string, right: string, cls = "") => `<div class="row ${cls}"><span>${left}</span><span class="num">${right}</span></div>`;
  const store = data.seller.storeName || data.seller.name;
  // One basis for lines and totals (VAT included or before VAT), so every column and the totals block add up.
  const totals = documentTotals(data);
  const taxAr = taxName === "VAT" ? "ضريبة القيمة المضافة" : taxName === "GST" ? "ضريبة السلع والخدمات" : "الضريبة";
  const lines = data.lines.map((line, index) => {
    const detail = `${qty(line.quantity)} × ${escapeHtml(money(line.unitPriceCents))}${line.discountCents > 0 ? ` <span class="muted">(−${escapeHtml(money(line.discountCents))})</span>` : ""}`;
    return `<div class="line"><div class="name">${escapeHtml(line.name)}</div>${row(detail, escapeHtml(money(totals.lineAmounts[index] ?? line.lineTotalCents)), "sub")}</div>`;
  }).join("");
  const totalsRow = (entry: TotalsRow): string => {
    const amount = escapeHtml(entry.amountCents < 0 ? `−${money(-entry.amountCents)}` : money(entry.amountCents));
    switch (entry.key) {
      case "subtotalExclTax": return row(label([`Subtotal (excl. ${taxName})`, `المجموع قبل ${taxAr}`], language), amount);
      case "itemsInclTax": return row(label([`Items total (incl. ${taxName})`, `إجمالي الأصناف شامل ${taxAr}`], language), amount);
      case "billDiscount": return row(label("billDiscount", language), amount);
      case "charges": return data.charges.map((charge) => row(escapeHtml(charge.name), escapeHtml(money(totals.basis === "INCL" ? charge.amountCents + charge.taxCents : charge.amountCents)))).join("");
      case "tax": return row(label("tax", language, taxName), amount);
      case "rounding": return row(label("rounding", language), amount);
      case "total": return `<div class="rule"></div>${row(label("total", language), amount, "total")}`;
      case "totalExclTax": return row(label([`Total excl. ${taxName}`, `الإجمالي قبل ${taxAr}`], language), amount, "small");
      case "taxIncluded": return row(label([`${taxName} included`, `${taxAr} المشمولة`], language), amount, "small");
    }
  };
  const payments = data.payments.map((payment) => {
    const name = label(TENDERS[payment.tenderType] ?? [payment.tenderType, payment.tenderType], language);
    const ref = payment.reference ? ` <span class="muted">${escapeHtml(payment.reference)}</span>` : "";
    const tendered = payment.tenderedCents !== null && payment.tenderedCents !== undefined && payment.tenderedCents !== payment.amountCents ? row(label("tendered", language), escapeHtml(money(payment.tenderedCents)), "sub") : "";
    return row(`${name}${ref}`, escapeHtml(money(payment.amountCents))) + tendered;
  }).join("");
  const breakdown = data.settings.showTaxBreakdown && totals.byRate.length
    ? `<div class="rule"></div><div class="small"><div class="row bold"><span>${label("taxSummary", language)}</span><span></span></div>${totals.byRate.map((entry) => row(`${escapeHtml(taxName)} ${pct(entry.taxRateBps)} · ${label("taxable", language)} ${escapeHtml(money(entry.taxableCents))}`, escapeHtml(money(entry.taxCents)))).join("")}</div>`
    : "";
  const itemCount = data.lines.reduce((sum, line) => sum + line.quantity, 0);
  return `<section class="receipt">
${test ? `<div class="banner">${label("test", language)}</div>` : ""}
${reprint ? `<div class="banner">${label("reprint", language)}</div>` : ""}
${data.status === "VOIDED" ? `<div class="banner">${label("voided", language)}</div>` : ""}
<header class="center">
  <div class="store">${escapeHtml(store)}</div>
  ${data.seller.name && data.seller.name !== store ? `<div>${escapeHtml(data.seller.name)}</div>` : ""}
  ${data.seller.storeAddress || data.seller.address ? `<div class="small">${escapeHtml(data.seller.storeAddress || data.seller.address)}</div>` : ""}
  ${data.seller.gstin ? `<div class="small">${label("taxNo", language)}: ${escapeHtml(data.seller.gstin)}</div>` : ""}
  ${data.header ? `<div class="small pre">${escapeHtml(data.header)}</div>` : ""}
  <div class="title">${label(data.seller.gstin ? "taxInvoice" : "receipt", language)}</div>
</header>
<div class="small">
  ${row(label("receiptNo", language), `<b>${escapeHtml(data.receiptNumber)}</b>`, "kv")}
  ${row(label("date", language), escapeHtml(dateText(data.issuedAt, data.timezone)), "kv")}
  ${data.register ? row(label("register", language), escapeHtml(data.register), "kv") : ""}
  ${data.cashier ? row(label("cashier", language), escapeHtml(data.cashier), "kv") : ""}
  ${data.customer ? row(label("customer", language), escapeHtml([data.customer.name, data.customer.phone].filter(Boolean).join(" · ")), "kv") : ""}
  ${data.buyer?.isBusiness && data.buyer.taxNumber ? row(label("taxNo", language), escapeHtml(data.buyer.taxNumber), "kv") : ""}
  ${data.customFields.map((field) => row(escapeHtml(field.label), escapeHtml(field.value), "kv")).join("")}
</div>
<div class="rule"></div>
<div class="row bold small"><span>${label("item", language)}</span><span>${label("amount", language)}</span></div>
<div class="rule thin"></div>
${lines}
<div class="rule"></div>
${row(`${label("items", language)}: ${qty(itemCount)}`, "", "small")}
${totals.rows.map(totalsRow).join("\n")}
${totals.savedCents > 0 ? row(label("saved", language), escapeHtml(money(totals.savedCents)), "small") : ""}
<div class="rule"></div>
${payments}
${data.changeCents > 0 ? row(label("change", language), escapeHtml(money(data.changeCents)), "bold") : ""}
${breakdown}
<div class="rule"></div>
<footer class="center">
  ${data.footer ? `<div class="pre">${escapeHtml(data.footer)}</div>` : ""}
  <div class="bold">${label("thanks", language)}</div>
  <div class="small muted">${escapeHtml(data.receiptNumber)}</div>
</footer>
</section>`;
}

/**
 * A complete, self-contained HTML document for the receipt, laid out for the chosen paper.
 * Printed from a hidden iframe so the till screen never navigates away.
 */
export function receiptHtml(data: ReceiptData, options: ReceiptOptions = {}): string {
  const paper: ReceiptPaper = options.paper ?? data.settings.paper ?? "80mm";
  const language: ReceiptLanguage = options.language ?? data.settings.language ?? "en";
  const copies = Math.min(3, Math.max(1, Math.round(options.copies ?? data.settings.copies ?? 1)));
  const reprint = options.reprint ?? data.isReprint;
  const width = WIDTH[paper];
  // "80mm auto" is not valid CSS, so roll paper starts at a fixed height and fitRollPage() sets the real height before printing.
  const size = paper === "A4" ? "A4" : `${paper} 297mm`;
  const margin = paper === "A4" ? "12mm" : "0";
  const font = paper === "58mm" ? "11px" : paper === "A4" ? "13px" : "12px";
  const bodies = Array.from({ length: copies }, (_, index) => receiptBody(data, language, reprint || index > 0, options.test === true)).join('<div class="cut"></div>');
  return `<!doctype html>
<html lang="${language === "ar" ? "ar" : "en"}" dir="${language === "ar" ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.receiptNumber)}</title>
<style>
  @page { size: ${size}; margin: ${margin}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: Arial, Tahoma, "Segoe UI", sans-serif; font-size: ${font}; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .receipt { width: ${width}; margin: 0 auto; padding: ${paper === "A4" ? "0" : "3mm 0 6mm"}; }
  .center { text-align: center; }
  .store { font-size: 1.35em; font-weight: 700; }
  .title { margin-top: 1.5mm; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
  .banner { border: 1.5px solid #000; text-align: center; font-weight: 700; padding: 1mm; margin-bottom: 2mm; }
  .row { display: flex; justify-content: space-between; gap: 2mm; align-items: baseline; }
  .row > span:first-child { min-width: 0; overflow-wrap: anywhere; }
  .num { white-space: nowrap; font-variant-numeric: tabular-nums; text-align: end; direction: ltr; unicode-bidi: isolate; }
  /* Names, header and footer keep their own direction inside an Arabic receipt (no reordered dates or full stops). */
  .kv > span:first-child { flex: none; }
  .kv .num { white-space: normal; overflow-wrap: anywhere; }
  .pre, .line .name, .row > span:first-child, .store { unicode-bidi: plaintext; }
  .line { margin: 1mm 0; break-inside: avoid; }
  .line .name { font-weight: 600; overflow-wrap: anywhere; }
  .sub { font-size: .92em; }
  .small { font-size: .9em; }
  .muted { color: #333; }
  .bold { font-weight: 700; }
  .total { font-size: 1.3em; font-weight: 800; }
  .rule { border-top: 1px dashed #000; margin: 1.5mm 0; }
  .rule.thin { border-top-style: dotted; }
  .pre { white-space: pre-line; }
  .ar { display: inline-block; }
  .cut { break-after: page; page-break-after: always; height: 0; }
  /* On screen only a frame is added; the receipt keeps its print width, so the measured height matches the paper. */
  @media screen { body { background: #f3f3f3; padding: 8mm 0; } .receipt { background: #fff; outline: 4mm solid #fff; box-shadow: 0 0 0 4mm #fff, 0 1px 10px 4mm rgba(0,0,0,.15); margin-bottom: 12mm; } }
</style>
</head>
<body${paper === "A4" ? "" : ` data-roll="${paper}"`}>${bodies}</body>
</html>`;
}

/**
 * Thermal rolls have no fixed page length. Measures the tallest receipt copy in the loaded document and sets the
 * page to exactly that height, so the printer feeds only as much paper as the receipt needs (and cuts after it).
 */
export function fitRollPage(doc: Document): string | null {
  const roll = doc.body?.dataset.roll;
  if (!roll) return null;
  const tallest = Math.max(0, ...Array.from(doc.querySelectorAll<HTMLElement>(".receipt")).map((section) => section.getBoundingClientRect().height));
  if (!tallest) return null;
  const heightMm = Math.ceil((tallest * 25.4) / 96) + 4;
  const style = doc.createElement("style");
  style.textContent = `@page { size: ${roll} ${heightMm}mm; margin: 0; }`;
  doc.head.appendChild(style);
  return `${roll} ${heightMm}mm`;
}

/** Sample data for the "Print test receipt" button in store settings. */
export function sampleReceipt(store: { name: string; address?: string; taxNumber?: string; currency: string; decimals: number }, settings: ReceiptData["settings"], text: { header: string; footer: string }): ReceiptData {
  const unit = 10 ** store.decimals;
  return {
    saleId: "test", storeId: "test", receiptNumber: "TEST-0001", issuedAt: new Date().toISOString(), timezone: "", status: "COMPLETED",
    currency: { code: store.currency, symbol: store.currency, decimals: store.decimals }, taxRegime: "VAT",
    seller: { name: store.name, address: store.address ?? "", gstin: store.taxNumber ?? "", storeName: store.name, storeCode: "", storeAddress: store.address ?? "" },
    header: text.header, footer: text.footer, customer: null, buyer: null, cashier: "Test cashier", register: "Register 1", customFields: [],
    lines: [
      { name: "Sample item with a long name to check wrapping", sku: "SKU-1", quantity: 2, unitPriceCents: unit, discountCents: 0, taxRateBps: 500, taxCents: Math.round(unit * 2 * 0.05), lineTotalCents: Math.round(unit * 2 * 1.05) },
      { name: "Second item", sku: "SKU-2", quantity: 1, unitPriceCents: unit * 3, discountCents: 0, taxRateBps: 500, taxCents: Math.round(unit * 3 * 0.05), lineTotalCents: Math.round(unit * 3 * 1.05) },
    ],
    subtotalCents: unit * 5, discountCents: 0, charges: [], taxCents: Math.round(unit * 5 * 0.05), roundingCents: 0, totalCents: Math.round(unit * 5 * 1.05),
    taxBreakdown: [{ taxRateBps: 500, taxableCents: unit * 5, taxCents: Math.round(unit * 5 * 0.05) }],
    payments: [{ tenderType: "CASH", amountCents: Math.round(unit * 5 * 1.05), tenderedCents: unit * 10, changeCents: unit * 10 - Math.round(unit * 5 * 1.05), reference: "" }],
    changeCents: unit * 10 - Math.round(unit * 5 * 1.05), printCount: 0, isReprint: false, settings,
  };
}

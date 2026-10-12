/**
 * Dependency-free GST tax invoice PDF (A4, standard Helvetica fonts).
 * Amounts are shown as "Rs." because the standard PDF fonts have no rupee glyph.
 */

export type InvoiceData = {
  invoiceNumber: string;
  issuedAt: Date;
  timezone: string;
  status: string;
  seller: { name: string; address: string; gstin: string; storeName: string; storeCode: string; storeAddress: string };
  customer: { name: string; phone: string } | null;
  cashier: string;
  register: string;
  lines: { name: string; sku: string; hsnCode: string; quantity: number; unitPriceCents: number; discountCents: number; taxRateBps: number; taxCents: number; lineTotalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  charges: { name: string; amountCents: number; taxCents: number; taxRateBps: number }[];
  taxCents: number;
  roundingCents: number;
  totalCents: number;
  payments: { tenderType: string; amountCents: number; reference: string }[];
  footer: string;
};

const W = 595.28;
const H = 841.89;
const M = 36;

const HELV: Record<string, number> = {};
const widths = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number);
widths.forEach((w, i) => { HELV[String.fromCharCode(32 + i)] = w; });

function textWidth(text: string, size: number, bold: boolean): number {
  let total = 0;
  for (const ch of text) total += HELV[ch] ?? 556;
  return (total / 1000) * size * (bold ? 1.06 : 1);
}

function clean(text: string): string {
  return text.replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\u00a0-\u00ff]/g, "?");
}

function esc(text: string): string {
  return clean(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function rupees(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString();
  const grouped = whole.length > 3 ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}` : whole;
  return `${negative ? '-' : ''}${grouped}.${String(abs % 100).padStart(2, '0')}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below100(n: number): string { return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`; }
function below1000(n: number): string { return n < 100 ? below100(n) : `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ''}`; }

/** Indian numbering: crore, lakh, thousand. */
export function amountInWords(cents: number): string {
  const total = Math.abs(Math.round(cents));
  const rupeesPart = Math.floor(total / 100);
  const paise = total % 100;
  const parts: string[] = [];
  let rest = rupeesPart;
  const crore = Math.floor(rest / 10000000); rest %= 10000000;
  const lakh = Math.floor(rest / 100000); rest %= 100000;
  const thousand = Math.floor(rest / 1000); rest %= 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  let words = `${parts.length ? parts.join(' ') : 'Zero'} Rupees`;
  if (paise) words += ` and ${below100(paise)} Paise`;
  return `${words} Only`;
}

class Page {
  ops: string[] = [];
  text(x: number, y: number, value: string, size = 9, bold = false, align: 'l' | 'r' | 'c' = 'l', maxWidth?: number) {
    let t = clean(value);
    if (maxWidth) while (t.length > 1 && textWidth(t, size, bold) > maxWidth) t = t.slice(0, -1);
    const w = textWidth(t, size, bold);
    const px = align === 'r' ? x - w : align === 'c' ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${px.toFixed(2)} ${(H - y).toFixed(2)} Td (${esc(t)}) Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6) {
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${(H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2).toFixed(2)} l S 0 G`);
  }
  rect(x: number, y: number, w: number, h: number, gray: number) {
    this.ops.push(`${gray} g ${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
  }
}

function wrap(text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of clean(text).split(/\r?\n/)) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (textWidth(next, size, false) > width && current) { out.push(current); current = word; } else current = next;
    }
    out.push(current);
  }
  return out.filter((value, index, all) => value || index < all.length - 1);
}

function formatDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function buildInvoicePdf(data: InvoiceData): Buffer {
  const pages: Page[] = [];
  let page = new Page();
  pages.push(page);
  let y = M;

  // Column layout (right edges, except item name which is left aligned).
  const cols = { no: M, item: M + 18, hsn: 262, qty: 318, rate: 368, disc: 410, taxable: 456, gst: 484, tax: 520, amount: W - M };
  const header = () => {
    page.rect(M, y - 9, W - 2 * M, 15, 0.92);
    page.text(cols.no + 2, y + 2, '#', 7.5, true);
    page.text(cols.item, y + 2, 'Item', 7.5, true);
    page.text(cols.hsn, y + 2, 'HSN', 7.5, true);
    page.text(cols.qty, y + 2, 'Qty', 7.5, true, 'r');
    page.text(cols.rate, y + 2, 'Rate', 7.5, true, 'r');
    page.text(cols.disc, y + 2, 'Disc', 7.5, true, 'r');
    page.text(cols.taxable, y + 2, 'Taxable', 7.5, true, 'r');
    page.text(cols.gst, y + 2, 'GST%', 7.5, true, 'r');
    page.text(cols.tax, y + 2, 'GST', 7.5, true, 'r');
    page.text(cols.amount, y + 2, 'Amount', 7.5, true, 'r');
    y += 14;
  };

  // Seller block
  page.text(M, y + 8, data.seller.name, 15, true);
  y += 22;
  const sellerAddress = [data.seller.storeName ? `${data.seller.storeName} (${data.seller.storeCode})` : '', data.seller.storeAddress || data.seller.address].filter(Boolean).join(' - ');
  for (const row of wrap(sellerAddress, 8.5, 330)) { page.text(M, y + 6, row, 8.5); y += 11; }
  if (data.seller.gstin) { page.text(M, y + 6, `GSTIN: ${data.seller.gstin}`, 8.5, true); y += 11; }
  // Invoice block (right)
  page.text(W - M, M + 8, 'TAX INVOICE', 14, true, 'r');
  page.text(W - M, M + 22, `Invoice No: ${data.invoiceNumber}`, 9, true, 'r');
  page.text(W - M, M + 33, `Date: ${formatDate(data.issuedAt, data.timezone)}`, 8.5, false, 'r');
  if (data.status && data.status !== 'COMPLETED') page.text(W - M, M + 44, `Status: ${data.status}`, 8.5, true, 'r');
  y = Math.max(y, M + 52) + 6;
  page.line(M, y, W - M, y, 0.8, 0.3);
  y += 14;

  // Customer / sale details
  page.text(M, y, 'Billed to', 7.5, true);
  page.text(300, y, 'Sale details', 7.5, true);
  y += 11;
  page.text(M, y, data.customer?.name || 'Walk-in customer', 9);
  page.text(300, y, `Cashier: ${data.cashier || '-'}`, 9);
  y += 11;
  if (data.customer?.phone) page.text(M, y, `Phone: ${data.customer.phone}`, 9);
  page.text(300, y, `Register: ${data.register || '-'}`, 9);
  y += 20;

  header();
  data.lines.forEach((line, index) => {
    const nameRows = wrap(`${line.name}${line.sku ? ` (${line.sku})` : ''}`, 8.5, cols.hsn - cols.item - 8);
    const rowHeight = Math.max(1, nameRows.length) * 10.5 + 5;
    if (y + rowHeight > H - 190) { page = new Page(); pages.push(page); y = M + 10; header(); }
    const taxable = line.lineTotalCents - line.taxCents;
    page.text(cols.no + 2, y + 8, String(index + 1), 8.5);
    nameRows.forEach((row, i) => page.text(cols.item, y + 8 + i * 10.5, row, 8.5));
    page.text(cols.hsn, y + 8, line.hsnCode || '-', 8.5);
    page.text(cols.qty, y + 8, String(Number.isInteger(line.quantity) ? line.quantity : line.quantity.toFixed(3)), 8.5, false, 'r');
    page.text(cols.rate, y + 8, rupees(line.unitPriceCents), 8.5, false, 'r');
    page.text(cols.disc, y + 8, line.discountCents ? rupees(line.discountCents) : '-', 8.5, false, 'r');
    page.text(cols.taxable, y + 8, rupees(taxable), 8.5, false, 'r');
    page.text(cols.gst, y + 8, `${(line.taxRateBps / 100).toFixed(line.taxRateBps % 100 ? 1 : 0)}`, 8.5, false, 'r');
    page.text(cols.tax, y + 8, rupees(line.taxCents), 8.5, false, 'r');
    page.text(cols.amount, y + 8, rupees(line.lineTotalCents), 8.5, false, 'r');
    y += rowHeight;
    page.line(M, y, W - M, y, 0.3, 0.85);
  });
  for (const charge of data.charges) {
    if (y + 18 > H - 190) { page = new Page(); pages.push(page); y = M + 10; header(); }
    page.text(cols.item, y + 8, charge.name, 8.5);
    page.text(cols.hsn, y + 8, 'Charge', 8.5);
    page.text(cols.taxable, y + 8, rupees(charge.amountCents), 8.5, false, 'r');
    page.text(cols.gst, y + 8, `${(charge.taxRateBps / 100).toFixed(charge.taxRateBps % 100 ? 1 : 0)}`, 8.5, false, 'r');
    page.text(cols.tax, y + 8, rupees(charge.taxCents), 8.5, false, 'r');
    page.text(cols.amount, y + 8, rupees(charge.amountCents + charge.taxCents), 8.5, false, 'r');
    y += 16;
    page.line(M, y, W - M, y, 0.3, 0.85);
  }

  if (y > H - 190) { page = new Page(); pages.push(page); y = M + 10; }
  y += 14;
  // GST summary by rate (CGST / SGST split) on the left, totals on the right.
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const line of data.lines) { const e = byRate.get(line.taxRateBps) ?? { taxable: 0, tax: 0 }; e.taxable += line.lineTotalCents - line.taxCents; e.tax += line.taxCents; byRate.set(line.taxRateBps, e); }
  for (const charge of data.charges) { const e = byRate.get(charge.taxRateBps) ?? { taxable: 0, tax: 0 }; e.taxable += charge.amountCents; e.tax += charge.taxCents; byRate.set(charge.taxRateBps, e); }
  let ly = y;
  page.text(M, ly, 'GST summary', 8, true); ly += 11;
  page.text(M, ly, 'Rate', 7.5, true); page.text(150, ly, 'Taxable', 7.5, true, 'r'); page.text(215, ly, 'CGST', 7.5, true, 'r'); page.text(280, ly, 'SGST', 7.5, true, 'r'); ly += 10;
  for (const [rate, value] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
    const half = Math.floor(value.tax / 2);
    page.text(M, ly, `${(rate / 100).toFixed(rate % 100 ? 1 : 0)}%`, 8);
    page.text(150, ly, rupees(value.taxable), 8, false, 'r'); page.text(215, ly, rupees(half), 8, false, 'r'); page.text(280, ly, rupees(value.tax - half), 8, false, 'r');
    ly += 10;
  }
  const right = W - M;
  const label = right - 120;
  let ry = y;
  const row = (name: string, value: string, bold = false) => { page.text(label, ry, name, bold ? 10 : 8.5, bold); page.text(right, ry, value, bold ? 10 : 8.5, bold, 'r'); ry += bold ? 15 : 11; };
  row('Subtotal (excl. GST)', rupees(data.subtotalCents));
  if (data.discountCents) row('Discount', `-${rupees(data.discountCents)}`);
  if (data.charges.length) row('Additional charges', rupees(data.charges.reduce((sum, c) => sum + c.amountCents, 0)));
  row('Total GST', rupees(data.taxCents));
  if (data.roundingCents) row('Rounding', rupees(data.roundingCents));
  page.line(label, ry - 8, right, ry - 8, 0.6, 0.3);
  ry += 2;
  row('Grand total', `Rs. ${rupees(data.totalCents)}`, true);
  y = Math.max(ly, ry) + 8;

  page.text(M, y, `Amount in words: ${amountInWords(data.totalCents)}`, 8.5, true);
  y += 16;
  page.text(M, y, 'Payment', 8, true);
  y += 11;
  for (const payment of data.payments) { page.text(M, y, `${payment.tenderType}${payment.reference ? ` (${payment.reference})` : ''}`, 8.5); page.text(220, y, `Rs. ${rupees(payment.amountCents)}`, 8.5, false, 'r'); y += 11; }
  if (data.footer) { y += 10; for (const rowText of wrap(data.footer, 8.5, W - 2 * M)) { page.text(W / 2, y, rowText, 8.5, false, 'c'); y += 11; } }
  y += 6;
  page.text(W / 2, Math.min(y + 8, H - 24), 'This is a computer generated invoice.', 7.5, false, 'c');

  // ── Assemble the PDF file ──
  const objects: string[] = [];
  const addObject = (body: string) => { objects.push(body); return objects.length; };
  const catalogId = addObject('');
  const pagesId = addObject('');
  const f1 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  pages.forEach((p, index) => {
    p.text(W - M, H - 14, `Page ${index + 1} of ${pages.length}`, 7.5, false, 'r');
    const content = p.ops.join('\n');
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    pageIds.push(addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

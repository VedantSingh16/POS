import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };
const PASSWORD = 'Plan14-Receipt-Password-1!';

describe('Plan 14 till receipt printing (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let adminToken: string;
  let seed: { storeId: string; registerId: string; variantId: string };
  let sessionId: string;
  const api = () => request(app.getHttpServer());
  /** Till actions run as a store manager: the organisation administrator has read-only access to store tills. */
  const auth = () => ({ Authorization: `Bearer ${token}`, 'x-store-id': seed.storeId });
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    adminToken = (await api().post('/api/auth/login').send(ADMIN).expect(200)).body.accessToken;
    seed = (await api().post('/api/pos/v1/demo/seed').set(admin()).expect(201)).body;
    await api().patch('/api/admin/settings').set(admin()).send({ inventoryPolicy: 'ALLOW' }).expect(200);
    await api().patch('/api/admin/organization').set(admin()).send({ taxProfileStatus: 'REGISTERED', gstin: 'OM1100012379' }).expect(200);
    const roles = (await api().get('/api/admin/roles').set(admin()).expect(200)).body.roles as { id: string; name: string }[];
    const roleId = roles.find((role) => role.name === 'Store Manager')!.id;
    const email = `receipt-manager-${Date.now()}@test.pos`;
    await api().post('/api/admin/users').set(admin()).send({ email, password: PASSWORD, firstName: 'Receipt', lastName: 'Manager', storeIds: [seed.storeId], roleAssignments: [{ roleId, scopeType: 'STORE', scopeId: seed.storeId }] }).expect(201);
    token = (await api().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
    sessionId = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, openingFloatCents: 0 }).expect(201)).body.id;
  });
  afterEach(async () => { await app.close(); });

  const sell = async (extra: Record<string, unknown>) => {
    const res = await api().post('/api/pos/v1/sales').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, sessionId, clientSaleId: `receipt-${Math.random().toString(36).slice(2)}`, ...extra });
    if (res.status !== 201) throw new Error(`sale failed ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body.sale as { id: string; receiptNumber: string; totalCents: number; taxCents: number; subtotalCents: number };
  };
  const settingsUrl = () => `/api/admin/stores/${seed.storeId}/settings`;

  it('returns the receipt with the same figures as the sale, tax summary by rate, tenders and change', async () => {
    await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptFooter: 'Thanks for shopping', receiptHeader: 'Tel 2400 0000' } }).expect(200);
    const sale = await sell({ lines: [{ variantId: seed.variantId, quantity: 2 }], payments: [{ tenderType: 'CASH', amountCents: 99800, tenderedCents: 100000 }] });
    const receipt = (await api().get(`/api/pos/v1/sales/${sale.id}/receipt`).set(auth()).expect(200)).body;

    expect(receipt.receiptNumber).toBe(sale.receiptNumber);
    expect(receipt.totalCents).toBe(sale.totalCents);
    expect(receipt.taxCents).toBe(sale.taxCents);
    expect(receipt.subtotalCents).toBe(sale.subtotalCents);
    expect(receipt.currency).toEqual({ code: 'OMR', symbol: 'OMR', decimals: 3 });
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0].quantity).toBe(2);
    // Tax summary adds up to the bill's tax.
    const breakdownTax = receipt.taxBreakdown.reduce((sum: number, entry: { taxCents: number }) => sum + entry.taxCents, 0);
    expect(breakdownTax).toBe(receipt.taxCents);
    expect(receipt.payments).toEqual([expect.objectContaining({ tenderType: 'CASH', amountCents: 99800, tenderedCents: 100000, changeCents: 200 })]);
    expect(receipt.changeCents).toBe(200);
    expect(receipt.footer).toBe('Thanks for shopping');
    expect(receipt.header).toBe('Tel 2400 0000');
    expect(receipt.cashier).toBeTruthy();
    expect(receipt.printCount).toBe(0);
    expect(receipt.isReprint).toBe(false);
    expect(receipt.settings).toEqual({ paper: '80mm', autoPrint: 'ASK', language: 'en', copies: 1, showTaxBreakdown: true });

    // The invoice PDF is built from the same document data and still shows the same total and number.
    const pdf = (await api().get(`/api/pos/v1/sales/${sale.id}/invoice.pdf`).set(auth()).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200)).body as Buffer;
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text).toContain(sale.receiptNumber);
    expect(text).toContain('OMR 99.800');
    expect(text).toContain('Thanks for shopping');
  });

  it('keeps the header and footer frozen at sale time, so a reprint matches the original', async () => {
    await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptFooter: 'Original footer', receiptHeader: 'Original header' } }).expect(200);
    const sale = await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CASH', amountCents: 49900 }] });
    await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptFooter: 'Changed footer', receiptHeader: 'Changed header', receiptPaper: '58mm', receiptCopies: 2 } }).expect(200);
    const receipt = (await api().get(`/api/pos/v1/sales/${sale.id}/receipt`).set(auth()).expect(200)).body;
    expect(receipt.footer).toBe('Original footer');
    expect(receipt.header).toBe('Original header');
    // Presentation settings (paper, copies) follow the store's current printer setup.
    expect(receipt.settings.paper).toBe('58mm');
    expect(receipt.settings.copies).toBe(2);
  });

  it('counts prints, marks later prints as reprints and audits each one', async () => {
    const sale = await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CARD', amountCents: 49900, reference: 'SLIP-1' }] });
    const first = (await api().post(`/api/pos/v1/sales/${sale.id}/printed`).set(auth()).send({ copies: 1, channel: 'BROWSER' }).expect(201)).body;
    expect(first.printCount).toBe(1);
    const receipt = (await api().get(`/api/pos/v1/sales/${sale.id}/receipt`).set(auth()).expect(200)).body;
    expect(receipt.isReprint).toBe(true);
    expect(receipt.payments[0].reference).toBe('SLIP-1');
    const second = (await api().post(`/api/pos/v1/sales/${sale.id}/printed`).set(auth()).send({}).expect(201)).body;
    expect(second.printCount).toBe(2);

    const audits = await app.get(PrismaService).auditLog.findMany({ where: { action: 'sale.receipt_printed', entityId: sale.id }, orderBy: { createdAt: 'asc' } });
    expect(audits).toHaveLength(2);
    expect((audits[0]!.metadata as { reprint: boolean }).reprint).toBe(false);
    expect((audits[1]!.metadata as { reprint: boolean }).reprint).toBe(true);
  });

  it('validates the print record and receipt settings', async () => {
    const sale = await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CASH', amountCents: 49900 }] });
    expect((await api().post(`/api/pos/v1/sales/${sale.id}/printed`).set(auth()).send({ copies: 9 })).status).toBe(400);
    expect((await api().post(`/api/pos/v1/sales/${sale.id}/printed`).set(auth()).send({ channel: 'FAX' })).status).toBe(400);
    expect((await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptPaper: '110mm' } })).status).toBe(400);
    expect((await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptAutoPrint: 'SOMETIMES' } })).status).toBe(400);
    expect((await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptCopies: 0 } })).status).toBe(400);
    expect((await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptLanguage: 'fr' } })).status).toBe(400);
    await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptAutoPrint: 'ALWAYS', receiptLanguage: 'both', receiptShowTaxBreakdown: false } }).expect(200);
    const receipt = (await api().get(`/api/pos/v1/sales/${sale.id}/receipt`).set(auth()).expect(200)).body;
    expect(receipt.settings).toEqual(expect.objectContaining({ autoPrint: 'ALWAYS', language: 'both', showTaxBreakdown: false }));
  });

  it('tells the till the store print setting through the checkout config', async () => {
    await api().patch(settingsUrl()).set(auth()).send({ billing: { receiptAutoPrint: 'NEVER', receiptCopies: 2 } }).expect(200);
    const config = (await api().get(`/api/pos/v1/stores/${seed.storeId}/checkout-config`).set(auth()).expect(200)).body;
    expect(config.receipt).toEqual({ autoPrint: 'NEVER', paper: '80mm', copies: 2 });
  });

  it('prints totals that add up when there are line and bill discounts (Plan 15 Phase A)', async () => {
    // Two units at 49.900 incl. 5% VAT, 4% off the line, plus a 4% bill discount (under the 10% approval threshold).
    const bill = { lines: [{ variantId: seed.variantId, quantity: 2, discountPercent: 4 }], discountPercent: 4 };
    const quote = (await api().post('/api/pos/v1/sales/quote').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, sessionId, ...bill }).expect(201)).body;
    const sale = await sell({ ...bill, quoteHash: quote.quoteHash, payments: [{ tenderType: 'CASH', amountCents: quote.totalCents }] });
    const receipt = (await api().get(`/api/pos/v1/sales/${sale.id}/receipt`).set(auth()).expect(200)).body;
    expect(receipt.totals.basis).toBe('INCL');
    const rows = receipt.totals.rows as { key: string; amountCents: number }[];
    const totalIndex = rows.findIndex((row) => row.key === 'total');
    expect(rows.slice(0, totalIndex).reduce((sum, row) => sum + row.amountCents, 0)).toBe(sale.totalCents);
    expect(rows[0]).toEqual({ key: 'itemsInclTax', amountCents: receipt.lines[0].lineTotalCents });
    expect(rows.some((row) => row.key === 'billDiscount' && row.amountCents < 0)).toBe(true);
    // The tax summary after the bill discount adds up to the bill's tax and to the total before tax.
    const byRate = receipt.taxBreakdown as { taxableCents: number; taxCents: number }[];
    expect(byRate.reduce((sum, entry) => sum + entry.taxCents, 0)).toBe(receipt.taxCents);
    expect(byRate.reduce((sum, entry) => sum + entry.taxableCents, 0)).toBe(receipt.totalCents - receipt.roundingCents - receipt.taxCents);
    expect(receipt.totals.savedCents).toBeGreaterThan(0);

    const pdf = ((await api().get(`/api/pos/v1/sales/${sale.id}/invoice.pdf`).set(auth()).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200)).body as Buffer).toString('latin1');
    const netLine = receipt.lines[0].lineTotalCents - receipt.lines[0].taxCents;
    const fmt = (minor: number) => (minor / 1000).toFixed(3);
    expect(pdf).toContain(fmt(netLine)); // Subtotal (excl. VAT) = the line's taxable amount
    expect(pdf).toContain('Bill discount');
    expect(pdf).toContain('Line discounts');
    expect(pdf).not.toMatch(/\(Discount\)/);
  });

  it('saves the receipt printer of each register, confirms its test print, and tells the till (Plan 15 Phase D)', async () => {
    const url = `/api/pos/v1/registers/${seed.registerId}/printer`;
    // Not set up yet: falls back to the store's paper.
    expect((await api().get(url).set(auth()).expect(200)).body).toEqual(expect.objectContaining({ registerId: seed.registerId, paper: null, setupConfirmedAt: null, effectivePaper: '80mm' }));
    const chosen = (await api().patch(url).set(auth()).send({ paper: '58mm' }).expect(200)).body;
    expect(chosen).toEqual(expect.objectContaining({ paper: '58mm', effectivePaper: '58mm', setupConfirmedAt: null }));
    const confirmed = (await api().patch(url).set(auth()).send({ confirmed: true }).expect(200)).body;
    expect(confirmed.setupConfirmedAt).toBeTruthy();
    expect(confirmed.setupConfirmedBy).toContain('Receipt');
    const config = (await api().get(`/api/pos/v1/stores/${seed.storeId}/checkout-config`).set(auth()).expect(200)).body;
    expect(config.registerPrinters[seed.registerId]).toEqual(expect.objectContaining({ paper: '58mm', setupConfirmedAt: confirmed.setupConfirmedAt }));
    // A different printer needs a new test print.
    expect((await api().patch(url).set(auth()).send({ paper: '80mm' }).expect(200)).body.setupConfirmedAt).toBeNull();
    // Bad input and unknown registers.
    expect((await api().patch(url).set(auth()).send({ paper: 'Letter' })).status).toBe(400);
    expect((await api().patch(url).set(auth()).send({ confirmed: 'yes' })).status).toBe(400);
    expect((await api().get('/api/pos/v1/registers/00000000-0000-4000-8000-000000000000/printer').set(auth())).status).toBe(404);
    expect((await api().get(url)).status).toBe(401);
    const audits = await app.get(PrismaService).auditLog.findMany({ where: { action: 'register.printer_updated', entityId: seed.registerId } });
    expect(audits).toHaveLength(3);
  });

  it('does not let someone without billing access change a till printer', async () => {
    const roles = (await api().get('/api/admin/roles').set(admin()).expect(200)).body.roles as { id: string; name: string }[];
    const inventory = roles.find((role) => role.name === 'Inventory User')!;
    expect(inventory).toBeTruthy();
    const email = `inventory-${Date.now()}@test.pos`;
    await api().post('/api/admin/users').set(admin()).send({ email, password: PASSWORD, firstName: 'Stock', lastName: 'Keeper', storeIds: [seed.storeId], roleAssignments: [{ roleId: inventory.id, scopeType: 'STORE', scopeId: seed.storeId }] }).expect(201);
    const stockToken = (await api().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken;
    const res = await api().patch(`/api/pos/v1/registers/${seed.registerId}/printer`).set({ Authorization: `Bearer ${stockToken}`, 'x-store-id': seed.storeId }).send({ paper: 'A4' });
    expect(res.status).toBe(403);
  });

  it('does not show a receipt for an unknown sale or a malformed id', async () => {
    expect((await api().get('/api/pos/v1/sales/00000000-0000-4000-8000-000000000000/receipt').set(auth())).status).toBe(404);
    expect((await api().get('/api/pos/v1/sales/not-a-uuid/receipt').set(auth())).status).toBe(400);
    expect((await api().post('/api/pos/v1/sales/00000000-0000-4000-8000-000000000000/printed').set(auth()).send({})).status).toBe(404);
    expect((await api().get('/api/pos/v1/sales/00000000-0000-4000-8000-000000000000/receipt')).status).toBe(401);
  });
});

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { gstinCheckChar } from '@pos/shared/tax-id';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };
const PIN = '2468';

function gstin(state: string, pan: string) {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
}

describe('Plan 6 B2B, invoice, payments, holds (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let seed: { storeId: string; registerId: string; variantId: string };
  let sessionId: string;
  let managerToken: string;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const prisma = () => app.get(PrismaService);
  let counter = 0;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    token = (await api().post('/api/auth/login').send(ADMIN).expect(200)).body.accessToken;
    seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'ALLOW', currency: 'INR' }).expect(200);
    sessionId = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, openingFloatCents: 0 }).expect(201)).body.id;
  });
  afterEach(async () => { await app.close(); });

  const product = async (amountCents: number, extra: Record<string, unknown> = {}) => {
    counter += 1;
    const sku = `P6-${counter}-${Date.now() % 100000}`;
    const res = await api().post(`/api/pos/v1/stores/${seed.storeId}/products`).set(auth()).send({ name: `Item ${sku}`, sku, amountCents, openingQuantity: 100, ...extra }).expect(201);
    return { variantId: res.body.variantId as string, sku };
  };
  const body = (extra: Record<string, unknown>) => ({ storeId: seed.storeId, registerId: seed.registerId, sessionId, ...extra });
  const quote = (extra: Record<string, unknown>) => api().post('/api/pos/v1/sales/quote').set(auth()).send(body(extra));
  const sell = (extra: Record<string, unknown>) => api().post('/api/pos/v1/sales').set(auth()).send(body(extra));
  const lineOf = (variantId: string, quantity = 1, more: Record<string, unknown> = {}) => ({ variantId, quantity, ...more });
  const manager = async () => {
    const roles = (await api().get('/api/admin/roles').set(auth()).expect(200)).body.roles as { id: string; name: string }[];
    const role = roles.find((r) => r.name === 'Store Manager')!;
    const email = `mgr-${Date.now()}@test.pos`;
    await api().post('/api/admin/users').set(auth()).send({ email, password: 'Manager-Password-2026!', firstName: 'M', lastName: 'G', storeIds: [seed.storeId], roleAssignments: [{ roleId: role.id, scopeType: 'ORGANIZATION', scopeId: null }] }).expect(201);
    managerToken = (await api().post('/api/auth/login').send({ email, password: 'Manager-Password-2026!' }).expect(200)).body.accessToken;
    await api().post('/api/auth/pin').set({ Authorization: `Bearer ${managerToken}` }).send({ pin: PIN }).expect(204);
  };

  const attempt = (amountCents: number, key: string, extra: Record<string, unknown> = {}) =>
    api().post('/api/pos/v1/payments/attempts').set(auth()).send({ storeId: seed.storeId, tenderType: 'CARD', amountCents, idempotencyKey: key, ...extra });

  // ───────── B2B + invoice ─────────
  it('validates GSTIN, then issues an intra-state CGST/SGST and an inter-state IGST invoice', async () => {
    const good = gstin('27', 'ABCDE1234F');
    // The store's own GSTIN is set through the settings endpoint; a bad one is refused.
    await api().patch(`/api/admin/stores/${seed.storeId}/settings`).set(auth()).send({ taxNumber: '27ABCDE1234F1ZX' }).expect(400);
    const stored = await api().patch(`/api/admin/stores/${seed.storeId}/settings`).set(auth()).send({ taxNumber: gstin('27', 'SELLR9999Z').toLowerCase() }).expect(200);
    expect(stored.body.taxNumber).toBe(gstin('27', 'SELLR9999Z'));
    const badCheck = good.slice(0, 14) + (good[14] === 'A' ? 'B' : 'A');
    const bad = await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Bad GST', isBusiness: true, taxNumber: badCheck });
    expect(bad.status).toBe(400);
    const noGstin = await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'No GST', isBusiness: true });
    expect(noGstin.status).toBe(400);
    const maha = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Maha Traders', legalName: 'Maha Traders Pvt Ltd', billingAddress: '1 MG Road, Pune', taxNumber: good }).expect(201)).body;
    expect(maha.isBusiness).toBe(true);
    expect(maha.stateCode).toBe('27');
    const delhi = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Delhi Co', legalName: 'Delhi Co LLP', taxNumber: gstin('07', 'PQRST5678K') }).expect(201)).body;
    await api().patch(`/api/pos/v1/customers/${delhi.id}`).set(auth()).send({ billingAddress: 'Connaught Place' }).expect(200);

    const text = async (customerId: string) => {
      const sale = (await sell({ customerId, lines: [lineOf(seed.variantId)], payments: [{ tenderType: 'CARD', amountCents: 49900 }] }).expect(201)).body.sale;
      const pdf = await api().get(`/api/pos/v1/sales/${sale.id}/invoice.pdf`).set(auth()).buffer(true).parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); }).expect(200);
      return { sale, text: (pdf.body as Buffer).toString('latin1'), buf: pdf.body as Buffer };
    };
    const intra = await text(maha.id);
    expect(intra.buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(intra.text).toContain('Maha Traders Pvt Ltd');
    expect(intra.text).toContain(good);
    expect(intra.text).toContain('CGST');
    expect(intra.text).not.toContain('IGST');
    const inter = await text(delhi.id);
    expect(inter.text).toContain('IGST');
    expect(inter.text).not.toContain('CGST');
    expect(inter.sale.receiptNumber).toMatch(/^TAX-\d{4}-\d{6}$/);
  });

  it('keeps a printed invoice identical after the customer and organisation are edited', async () => {
    const customer = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Snap Co', legalName: 'Snap Original Ltd', taxNumber: gstin('29', 'SNAPS1234A') }).expect(201)).body;
    const sale = (await sell({ customerId: customer.id, lines: [lineOf(seed.variantId)], payments: [{ tenderType: 'CARD', amountCents: 49900 }] }).expect(201)).body.sale;
    const fetchText = async () => ((await api().get(`/api/pos/v1/sales/${sale.id}/invoice.pdf`).set(auth()).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200)).body as Buffer).toString('latin1');
    const before = await fetchText();
    expect(before).toContain('Snap Original Ltd');
    await api().patch(`/api/pos/v1/customers/${customer.id}`).set(auth()).send({ legalName: 'Renamed Ltd' }).expect(200);
    await prisma().organization.updateMany({ data: { legalName: 'Totally New Legal Name' } });
    const after = await fetchText();
    expect(after).toContain('Snap Original Ltd');
    expect(after).not.toContain('Renamed Ltd');
    expect(after).not.toContain('Totally New Legal Name');
  });

  // ───────── payments ─────────
  it('takes an online payment, replays it by key, and links it to the sale', async () => {
    const item = await product(10000);
    const a = (await attempt(10000, 'k-ok-1').expect(201)).body;
    expect(a.status).toBe('CAPTURED');
    const replay = (await attempt(10000, 'k-ok-1').expect(201)).body;
    expect(replay.id).toBe(a.id);
    expect(await prisma().paymentAttempt.count()).toBe(1);
    const sale = (await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CARD', attemptId: a.id }] }).expect(201)).body.sale;
    expect(sale.totalCents).toBe(10000);
    // the same confirmed payment cannot pay a second bill
    const reuse = await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CARD', attemptId: a.id }] });
    expect(reuse.status).toBeGreaterThanOrEqual(400);
    // and a linked payment cannot be voided
    expect((await api().post(`/api/pos/v1/payments/attempts/${a.id}/void`).set(auth())).status).toBe(409);
  });

  it('declined payment cannot be used; unknown blocks a retry until resolved; pending captures on refresh', async () => {
    const declined = (await attempt(10051, 'k-dec').expect(201)).body;
    expect(declined.status).toBe('FAILED');
    const item = await product(10051);
    expect((await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CARD', attemptId: declined.id }] })).status).toBeGreaterThanOrEqual(400);

    const unknown = (await attempt(10054, 'k-unk', { clientSaleId: 'bill-1' }).expect(201)).body;
    expect(unknown.status).toBe('UNKNOWN');
    const blocked = await attempt(10054, 'k-unk-2', { clientSaleId: 'bill-1' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('PAYMENT_UNRESOLVED');
    expect((await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CARD', attemptId: unknown.id }] })).status).toBeGreaterThanOrEqual(400);

    const pending = (await attempt(10053, 'k-pend').expect(201)).body;
    expect(pending.status).toBe('PENDING');
    const refreshed = (await api().get(`/api/pos/v1/payments/attempts/${pending.id}`).set(auth()).expect(200)).body;
    expect(refreshed.status).toBe('CAPTURED');
  });

  it('reverses a captured payment automatically when the sale cannot be saved', async () => {
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'BLOCK' }).expect(200);
    const item = await product(10000, { openingQuantity: 0 });
    const a = (await attempt(10000, 'k-rev').expect(201)).body;
    const res = await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CARD', attemptId: a.id }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const row = await prisma().paymentAttempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe('VOIDED');
    expect(await prisma().sale.count()).toBe(0);
  });

  it('raises a critical alert when the automatic reversal fails', async () => {
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'BLOCK' }).expect(200);
    const item = await product(10055, { openingQuantity: 0 });
    const a = (await attempt(10055, 'k-revfail').expect(201)).body;
    expect(a.status).toBe('CAPTURED');
    expect((await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CARD', attemptId: a.id }] })).status).toBeGreaterThanOrEqual(400);
    const row = await prisma().paymentAttempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe('UNKNOWN');
    const alerts = (await api().get('/api/pos/v1/alerts').set(auth()).expect(200)).body.alerts;
    expect(alerts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'PAYMENT_REVERSAL_FAILED' })]));
  });

  it('splits one bill across cash, card and wallet and debits the wallet', async () => {
    const item = await product(10000);
    const customer = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Wallet User' }).expect(201)).body;
    await api().post(`/api/pos/v1/customers/${customer.id}/ledger`).set(auth()).send({ type: 'CREDIT', amountCents: 3000 }).expect(201);
    const card = (await attempt(3000, 'k-split').expect(201)).body;
    const sale = (await sell({ customerId: customer.id, lines: [lineOf(item.variantId)], payments: [
      { tenderType: 'CASH', amountCents: 4000 }, { tenderType: 'CARD', attemptId: card.id }, { tenderType: 'WALLET', amountCents: 3000 },
    ] }).expect(201)).body.sale;
    expect(sale.payments).toHaveLength(3);
    const fresh = await prisma().customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(fresh.walletBalanceCents).toBe(0);
    // not enough wallet
    const over = await sell({ customerId: customer.id, lines: [lineOf(item.variantId)], payments: [{ tenderType: 'WALLET', amountCents: 10000 }] });
    expect(over.status).toBe(400);
    // wrong total
    expect((await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CASH', amountCents: 9000 }] })).status).toBe(400);
  });

  it('pays with points and respects the enabledTenders setting', async () => {
    const item = await product(10000);
    const customer = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Points User' }).expect(201)).body;
    await prisma().customer.update({ where: { id: customer.id }, data: { pointsBalance: 500 } });
    await sell({ customerId: customer.id, lines: [lineOf(item.variantId)], payments: [{ tenderType: 'POINTS', amountCents: 5000 }, { tenderType: 'CASH', amountCents: 5000 }] }).expect(201);
    // 500 points spent; the ₹50.00 paid in cash earns 10 new ones.
    expect((await prisma().customer.findUniqueOrThrow({ where: { id: customer.id } })).pointsBalance).toBe(10);
    await api().patch('/api/admin/settings').set(auth()).send({ enabledTenders: ['CASH'] }).expect(200);
    const off = await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CARD', amountCents: 10000 }] });
    expect(off.status).toBe(400);
    await sell({ lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CASH', amountCents: 10000 }] }).expect(201);
  });

  it('a retried checkout with the same clientSaleId returns the same sale and does not double-count', async () => {
    const item = await product(10000);
    const payload = { clientSaleId: 'retry-1', lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CASH', amountCents: 10000 }] };
    const one = (await sell(payload).expect(201)).body.sale;
    const two = (await sell(payload).expect(201)).body.sale;
    expect(two.id).toBe(one.id);
    expect(await prisma().sale.count()).toBe(1);
  });

  // ───────── holds, top sellers ─────────
  it('expires held sales and refuses to resume them', async () => {
    const hold = (await api().post('/api/pos/v1/holds').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, clientHoldId: 'h-1', payload: { lines: [] } }).expect(201)).body;
    const id = hold.id as string;
    await prisma().heldSale.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const list = (await api().get(`/api/pos/v1/holds?storeId=${seed.storeId}`).set(auth()).expect(200)).body.holds;
    expect(list.find((h: { id: string }) => h.id === id)).toBeUndefined();
    expect((await api().post(`/api/pos/v1/holds/${id}/resume`).set(auth())).status).toBe(410);
  });

  it('shows pinned items first, then best sellers, in top-sellers', async () => {
    const a = await product(10000);
    const b = await product(10000);
    const c = await product(10000);
    await sell({ lines: [lineOf(b.variantId, 5)], payments: [{ tenderType: 'CASH', amountCents: 50000 }] }).expect(201);
    await sell({ lines: [lineOf(c.variantId, 1)], payments: [{ tenderType: 'CASH', amountCents: 10000 }] }).expect(201);
    await api().patch('/api/pos/v1/store-products').set(auth()).send({ storeId: seed.storeId, variantId: a.variantId, pinned: true, pinnedRank: 1 }).expect(200);
    const res = (await api().get(`/api/pos/v1/catalog/top-sellers?storeId=${seed.storeId}&limit=3`).set(auth()).expect(200)).body;
    const ids = (res.items ?? res.variants ?? res.products).map((x: { variantId: string; id?: string }) => x.variantId ?? x.id);
    expect(ids.slice(0, 3)).toEqual([a.variantId, b.variantId, c.variantId]);
  });
});

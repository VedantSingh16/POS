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

describe('Plan 6 pricing, checkout, payments, invoice (e2e)', () => {
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

  // ───────── pricing ─────────
  it('blocks an item that has no price (NO_PRICE)', async () => {
    const item = await product(10000);
    await prisma().variantPrice.deleteMany({ where: { variantId: item.variantId } });
    const res = await quote({ lines: [lineOf(item.variantId)] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('NO_PRICE');
  });

  it('applies a customer-group price rule and a quantity tier, highest priority first', async () => {
    const item = await product(10000);
    const customer = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Wholesale Co', groupName: 'Wholesale' }).expect(201)).body;
    await api().post('/api/pos/v1/price-rules').set(auth()).send({ name: 'Wholesale', scope: 'VARIANT', scopeId: item.variantId, mode: 'FIXED', value: 8000, customerGroup: 'Wholesale', priority: 5 }).expect(201);
    await api().post('/api/pos/v1/price-rules').set(auth()).send({ name: 'Bulk 10', scope: 'VARIANT', scopeId: item.variantId, mode: 'PERCENT_OFF', value: 2000, minQuantity: 10, priority: 1 }).expect(201);
    const plain = await quote({ lines: [lineOf(item.variantId)] }).expect(201);
    expect(plain.body.lines[0].unitPriceCents).toBe(10000);
    const group = await quote({ customerId: customer.id, lines: [lineOf(item.variantId)] }).expect(201);
    expect(group.body.lines[0].unitPriceCents).toBe(8000);
    expect(group.body.lines[0].priceRuleName).toBe('Wholesale');
    const bulk = await quote({ lines: [lineOf(item.variantId, 10)] }).expect(201);
    expect(bulk.body.lines[0].unitPriceCents).toBe(8000);
    expect(bulk.body.lines[0].priceRuleName).toBe('Bulk 10');
    // a staff member without pricing.manage cannot create rules
    await api().post('/api/pos/v1/price-rules').send({}).expect(401);
  });

  // ───────── coupons / promotions ─────────
  it('applies a coupon, rejects bad ones, counts usage and freezes the total with quoteHash', async () => {
    await api().post('/api/pos/v1/promotions').set(auth()).send({ code: 'TEN', type: 'PERCENT', value: 10, usageLimit: 1 }).expect(201);
    await api().post('/api/pos/v1/promotions').set(auth()).send({ code: 'OLD', type: 'PERCENT', value: 10, endsAt: '2020-01-01T00:00:00Z' }).expect(201);
    const q = (await quote({ lines: [lineOf(seed.variantId)], couponCode: 'ten' }).expect(201)).body;
    expect(q.promotionDiscountCents).toBe(4752);
    expect(q.totalCents).toBe(44910);
    const expired = (await quote({ lines: [lineOf(seed.variantId)], couponCode: 'OLD' }).expect(201)).body;
    expect(expired.promotionDiscountCents).toBe(0);
    expect(expired.rejectedPromotions[0].reason).toBe('EXPIRED');
    const unknown = (await quote({ lines: [lineOf(seed.variantId)], couponCode: 'NOPE' }).expect(201)).body;
    expect(unknown.rejectedPromotions[0].reason).toBe('NOT_FOUND');

    // price changed after the screen was priced → 409
    const stale = await sell({ lines: [lineOf(seed.variantId)], couponCode: 'TEN', quoteHash: 'deadbeefdeadbeef', payments: [{ tenderType: 'CASH', amountCents: 44910 }] });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('PRICE_CHANGED');

    const done = await sell({ lines: [lineOf(seed.variantId)], couponCode: 'TEN', quoteHash: q.quoteHash, payments: [{ tenderType: 'CASH', amountCents: 44910 }] }).expect(201);
    expect(done.body.sale.totalCents).toBe(44910);
    const promo = (await api().get('/api/pos/v1/promotions').set(auth()).expect(200)).body.promotions.find((p: { code: string }) => p.code === 'TEN');
    expect(promo.usageCount).toBe(1);
    // limit of 1 reached
    const again = (await quote({ lines: [lineOf(seed.variantId)], couponCode: 'TEN' }).expect(201)).body;
    expect(again.rejectedPromotions[0].reason).toBe('LIMIT_REACHED');
  });

  it('lets only one of two simultaneous sales claim the last use of a coupon', async () => {
    await api().post('/api/pos/v1/promotions').set(auth()).send({ code: 'LAST', type: 'PERCENT', value: 10, usageLimit: 1 }).expect(201);
    const item = await product(10000);
    const q = (await quote({ lines: [lineOf(item.variantId)], couponCode: 'LAST' }).expect(201)).body;
    const fire = () => sell({ lines: [lineOf(item.variantId)], couponCode: 'LAST', payments: [{ tenderType: 'CASH', amountCents: q.totalCents }] });
    const results = await Promise.all([fire(), fire()]);
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(1);
    const failed = results.find((r) => r.status !== 201)!;
    expect(failed.status).toBe(409);
    const promo = (await api().get('/api/pos/v1/promotions').set(auth()).expect(200)).body.promotions.find((p: { code: string }) => p.code === 'LAST');
    expect(promo.usageCount).toBe(1);
  });

  it('applies an automatic promotion without a code and caps per-customer use', async () => {
    const item = await product(10000);
    await api().post('/api/pos/v1/promotions').set(auth()).send({ code: 'AUTO5', type: 'PERCENT', value: 5, autoApply: true }).expect(201);
    await api().post('/api/pos/v1/promotions').set(auth()).send({ code: 'ONCE', type: 'AMOUNT', value: 10, perCustomerLimit: 1 }).expect(201);
    const auto = (await quote({ lines: [lineOf(item.variantId)] }).expect(201)).body;
    expect(auto.promotionDiscountCents).toBe(500);
    const customer = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Repeat' }).expect(201)).body;
    const first = (await quote({ customerId: customer.id, couponCode: 'ONCE', lines: [lineOf(item.variantId)] }).expect(201)).body;
    expect(first.promotionDiscountCents).toBe(1000);
    await sell({ customerId: customer.id, couponCode: 'ONCE', lines: [lineOf(item.variantId)], payments: [{ tenderType: 'CASH', amountCents: first.totalCents }] }).expect(201);
    const second = (await quote({ customerId: customer.id, couponCode: 'ONCE', lines: [lineOf(item.variantId)] }).expect(201)).body;
    expect(second.rejectedPromotions.find((r: { code: string }) => r.code === 'ONCE').reason).toBe('CUSTOMER_LIMIT');
  });

  // ───────── open price, discount reasons ─────────
  it('open-price items need an entered price above the floor and a manager PIN', async () => {
    await manager();
    const item = await product(1000);
    await prisma().productVariant.update({ where: { id: item.variantId }, data: { openPrice: true, floorPriceCents: 500 } });
    // With a list price on file and nothing entered, the list price is used and no approval is needed.
    const listed = (await quote({ lines: [lineOf(item.variantId)] }).expect(201)).body;
    expect(listed.requiresManagerApproval).toBe(false);
    expect(listed.lines[0].unitPriceCents).toBe(1000);
    await prisma().variantPrice.deleteMany({ where: { variantId: item.variantId } });
    const missing = await quote({ lines: [lineOf(item.variantId)] });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain('OPEN_PRICE_REQUIRED');
    const low = await quote({ lines: [lineOf(item.variantId, 1, { unitPriceCents: 400 })] });
    expect(low.status).toBe(400);
    const q = (await quote({ lines: [lineOf(item.variantId, 1, { unitPriceCents: 700, priceIncludesTax: true })] }).expect(201)).body;
    expect(q.requiresManagerApproval).toBe(true);
    const noPin = await sell({ lines: [lineOf(item.variantId, 1, { unitPriceCents: 700 })], payments: [{ tenderType: 'CASH', amountCents: q.totalCents }] });
    expect(noPin.status).toBeGreaterThanOrEqual(400);
    const ok = await sell({ managerPin: PIN, lines: [lineOf(item.variantId, 1, { unitPriceCents: 700 })], payments: [{ tenderType: 'CASH', amountCents: q.totalCents }] });
    expect(ok.status).toBe(201);
    expect(await prisma().approval.count({ where: { action: 'OPEN_PRICE' } })).toBe(1);
  });

  it('requires a discount reason when the setting is on', async () => {
    const item = await product(10000);
    await api().post('/api/pos/v1/discount-reasons').set(auth()).send({ code: 'DAMAGED', name: 'Damaged packaging' }).expect(201);
    await api().patch('/api/admin/settings').set(auth()).send({ requireDiscountReasonCode: true }).expect(200);
    const reasons = (await api().get(`/api/pos/v1/discount-reasons?storeId=${seed.storeId}`).set(auth()).expect(200)).body.reasons;
    expect(reasons.map((r: { code: string }) => r.code)).toContain('DAMAGED');
    const without = await sell({ lines: [lineOf(item.variantId, 1, { discountCents: 100, discountReason: 'x' })], payments: [{ tenderType: 'CASH', amountCents: 9900 }] });
    expect(without.status).toBe(400);
    const withCode = await sell({ discountReasonCode: 'DAMAGED', lines: [lineOf(item.variantId, 1, { discountCents: 100 })], payments: [{ tenderType: 'CASH', amountCents: 9900 }] });
    expect(withCode.status).toBe(201);
  });

  it('turns offers, price rules and discount reasons off and on from the admin screens', async () => {
    const item = await product(10000);
    const promo = (await api().post('/api/pos/v1/promotions').set(auth()).send({ code: 'SWITCH', type: 'PERCENT', value: 10 }).expect(201)).body;
    const rule = (await api().post('/api/pos/v1/price-rules').set(auth()).send({ name: 'Half', scope: 'VARIANT', scopeId: item.variantId, mode: 'PERCENT_OFF', value: 5000 }).expect(201)).body;
    const reason = (await api().post('/api/pos/v1/discount-reasons').set(auth()).send({ code: 'STAFF', name: 'Staff' }).expect(201)).body;
    expect((await quote({ lines: [lineOf(item.variantId)] }).expect(201)).body.lines[0].unitPriceCents).toBe(5000);
    await api().patch(`/api/pos/v1/price-rules/${rule.id}`).set(auth()).send({ status: 'DISABLED' }).expect(200);
    expect((await quote({ lines: [lineOf(item.variantId)] }).expect(201)).body.lines[0].unitPriceCents).toBe(10000);
    await api().patch(`/api/pos/v1/promotions/${promo.id}`).set(auth()).send({ status: 'DISABLED' }).expect(200);
    const off = (await quote({ lines: [lineOf(item.variantId)], couponCode: 'SWITCH' }).expect(201)).body;
    expect(off.promotionDiscountCents).toBe(0); // a switched-off code behaves like an unknown one
    await api().patch(`/api/pos/v1/discount-reasons/${reason.id}`).set(auth()).send({ status: 'DISABLED' }).expect(200);
    const active = (await api().get(`/api/pos/v1/discount-reasons?storeId=${seed.storeId}`).set(auth()).expect(200)).body.reasons;
    expect(active.map((r: { code: string }) => r.code)).not.toContain('STAFF');
  });

  it('keeps product details organisation-only and tells the till whether out-of-stock items may be sold', async () => {
    await manager();
    const asManager = { Authorization: `Bearer ${managerToken}` };
    const denied = await api().post(`/api/pos/v1/stores/${seed.storeId}/products`).set(asManager).send({ name: 'Nope', sku: 'NOPE-1', amountCents: 1000 });
    expect(denied.status).toBe(403);
    const search = (await api().get(`/api/pos/v1/catalog/search?storeId=${seed.storeId}`).set(asManager).expect(200)).body;
    expect(search.inventoryPolicy).toBe('ALLOW');
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'BLOCK' }).expect(200);
    expect((await api().get(`/api/pos/v1/catalog/search?storeId=${seed.storeId}`).set(asManager).expect(200)).body.inventoryPolicy).toBe('BLOCK');
  });

  it('lets the organisation switch a variant to open price with a floor from the catalogue API', async () => {
    const item = await product(1000);
    const res = await api().patch(`/api/admin/catalog/variants/${item.variantId}`).set(auth()).send({ openPrice: true, floorPriceCents: 500 }).expect(200);
    const variant = res.body.variants.find((v: { id: string }) => v.id === item.variantId);
    expect(variant.openPrice).toBe(true);
    expect(variant.floorPriceCents).toBe(500);
  });
});

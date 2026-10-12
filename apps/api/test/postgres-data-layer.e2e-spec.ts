import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { seedFoundation } from './../src/bootstrap/foundation.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };

describe('PostgreSQL data layer (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    token = (await api().post('/api/auth/login').send(ADMIN).expect(200)).body.accessToken;
  });

  afterEach(async () => { await app.close(); });

  async function openTill(openingFloatCents = 0) {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    const session = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, openingFloatCents }).expect(201)).body;
    return { ...seed, sessionId: session.id as string };
  }

  const sell = (till: { storeId: string; registerId: string; sessionId: string; variantId: string }, clientSaleId: string, quantity = 1, tender = 'CASH') =>
    api().post('/api/pos/v1/sales').set(auth()).send({
      storeId: till.storeId, registerId: till.registerId, sessionId: till.sessionId, clientSaleId,
      lines: [{ variantId: till.variantId, quantity }],
      payments: [{ tenderType: tender, amountCents: 49900 * quantity }],
    });

  it('stores identifiers as uuid, timestamps as timestamptz and flags as boolean', async () => {
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND (
        (table_name = 'users' AND column_name IN ('id', 'created_at', 'organization_id')) OR
        (table_name = 'roles' AND column_name = 'is_system') OR
        (table_name = 'organization_settings' AND column_name = 'settings') OR
        (table_name = 'sale_lines' AND column_name = 'quantity'))`;
    const type = (table: string, column: string) => columns.find((c) => c.table_name === table && c.column_name === column)?.data_type;
    expect(type('users', 'id')).toBe('uuid');
    expect(type('users', 'organization_id')).toBe('uuid');
    expect(type('users', 'created_at')).toBe('timestamp with time zone');
    expect(type('roles', 'is_system')).toBe('boolean');
    expect(type('organization_settings', 'settings')).toBe('jsonb');
    expect(type('sale_lines', 'quantity')).toBe('numeric');
  });

  it('rejects malformed ids with 400 instead of a database error', async () => {
    await api().get('/api/pos/v1/sessions/not-a-uuid/summary').set(auth()).expect(400);
    await api().post('/api/pos/v1/transfers').set(auth()).send({ fromLocationId: 'x', toLocationId: 'y', lines: [{ variantId: 'z', quantity: 1 }] }).expect(400);
  });

  it('issues unique, sequential receipt numbers under concurrent checkout', async () => {
    const till = await openTill();
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => sell(till, `concurrent-${index}`)));
    responses.forEach((response) => expect(response.status).toBe(201));
    const numbers = responses.map((response) => response.body.sale.receiptNumber as string);
    expect(new Set(numbers).size).toBe(12);
    const sequence = numbers.map((value) => Number(value.split('-').pop())).sort((a, b) => a - b);
    expect(sequence).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it('returns the original sale when the same clientSaleId is submitted concurrently', async () => {
    const till = await openTill();
    const responses = await Promise.all(Array.from({ length: 5 }, () => sell(till, 'same-client-id')));
    responses.forEach((response) => expect(response.status).toBe(201));
    expect(new Set(responses.map((response) => response.body.sale.id)).size).toBe(1);
    const stock = (await api().get('/api/pos/v1/inventory').set(auth()).expect(200)).body.balances;
    expect(stock.find((row: { sku: string }) => row.sku === 'MUG-BLUE').quantity).toBe(-1);
  });

  it('keeps cash drawer, stock and credit notes consistent through a sale and a partial return', async () => {
    const till = await openTill(1000);
    const sale = (await sell(till, 'drawer-1', 2).expect(201)).body.sale;
    const returned = await api().post('/api/pos/v1/returns').set(auth()).send({
      saleId: sale.id, sessionId: till.sessionId, lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }], tenderType: 'CASH', reason: 'Changed mind',
    }).expect(201);
    expect(returned.body.totalCents).toBe(49900);
    await api().post('/api/pos/v1/returns').set(auth()).send({
      saleId: sale.id, sessionId: till.sessionId, lines: [{ saleLineId: sale.lines[0].id, quantity: 2 }], reason: 'Too many',
    }).expect(400);
    const summary = (await api().get(`/api/pos/v1/sessions/${till.sessionId}/summary`).set(auth()).expect(200)).body;
    expect(summary.session.expectedCashCents).toBe(1000 + 2 * 49900 - 49900);
    const stock = (await api().get('/api/pos/v1/inventory').set(auth()).expect(200)).body.balances;
    expect(stock.find((row: { sku: string; status: string }) => row.sku === 'MUG-BLUE' && row.status === 'SELLABLE').quantity).toBe(-1);
  });

  it('refunds the tax of tax-exclusive items on return', async () => {
    const cat = (await api().post('/api/admin/catalog/tax-groups').set(auth()).send({ code: 'GST18', name: 'GST 18%', ratePercent: 18 }).expect(201)).body;
    const product = (await api().post('/api/admin/catalog/products').set(auth()).send({ name: 'Exclusive item' }).expect(201)).body;
    const withVariant = (await api().post(`/api/admin/catalog/products/${product.id}/variants`).set(auth()).send({ sku: 'EXCL-1', name: 'One', taxGroupId: cat.id, amountCents: 10000, includesTax: false }).expect(201)).body;
    const variantId = withVariant.variants[0].id;
    const till = await openTill();
    await api().post('/api/pos/v1/store-products').set(auth()).send({ storeId: till.storeId, variantIds: [variantId] }).expect(201);
    const sale = (await api().post('/api/pos/v1/sales').set(auth()).send({
      storeId: till.storeId, registerId: till.registerId, sessionId: till.sessionId,
      lines: [{ variantId, quantity: 1 }], payments: [{ tenderType: 'CARD', amountCents: 11800 }],
    }).expect(201)).body.sale;
    expect(sale.taxCents).toBe(1800);
    const returned = await api().post('/api/pos/v1/returns').set(auth()).send({
      saleId: sale.id, sessionId: till.sessionId, lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }], tenderType: 'CARD', reason: 'Defect',
    }).expect(201);
    expect(returned.body.totalCents).toBe(11800);
  });

  it('refuses a second open session for the same register and allows it after closing', async () => {
    const till = await openTill();
    await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: till.storeId, registerId: till.registerId }).expect(409);
    await api().post(`/api/pos/v1/sessions/${till.sessionId}/close`).set(auth()).send({ countedCashCents: 0 }).expect(201);
    await api().post(`/api/pos/v1/sessions/${till.sessionId}/close`).set(auth()).send({ countedCashCents: 0 }).expect(400);
    await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: till.storeId, registerId: till.registerId }).expect(201);
  });

  it('never exceeds the store limit when stores are created concurrently', async () => {
    const results = await Promise.all(['A1', 'A2', 'A3', 'A4'].map((code) =>
      api().post('/api/admin/stores').set(auth()).send({ code, name: `Store ${code}` })));
    expect(results.filter((response) => response.status === 201)).toHaveLength(2);
    expect(results.filter((response) => response.status === 409)).toHaveLength(2);
    const overview = (await api().get('/api/admin/overview').set(auth()).expect(200)).body;
    expect(overview.entitlement.currentStores).toBe(2);
  });

  it('does not allow another organisation to reference this organisation’s records', async () => {
    const till = await openTill();
    await seedFoundation(prisma, {
      organizationName: 'Other Organisation', organizationSlug: 'test-organisation-b', maxStores: 3,
      adminEmail: 'admin@other.pos', adminPassword: 'Other-Admin-Password-2026!',
    });
    const otherToken = (await api().post('/api/auth/login').send({ email: 'admin@other.pos', password: 'Other-Admin-Password-2026!' }).expect(200)).body.accessToken;
    const other = () => ({ Authorization: `Bearer ${otherToken}` });

    const location = (await api().get('/api/pos/v1/locations').set(auth()).expect(200)).body.locations[0];
    // Another organisation's variant / location / store / session / sale are invisible: 404, never a leak or a 500.
    await api().post('/api/pos/v1/inventory/adjustments').set(other()).send({ locationId: location.id, variantId: till.variantId, quantity: 5, reason: 'x' }).expect(404);
    await api().post('/api/pos/v1/sessions').set(other()).send({ storeId: till.storeId, registerId: till.registerId }).expect(404);
    await api().get(`/api/pos/v1/sessions/${till.sessionId}/summary`).set(other()).expect(404);
    await api().post('/api/pos/v1/sales').set(other()).send({
      storeId: till.storeId, registerId: till.registerId, sessionId: till.sessionId, lines: [{ variantId: till.variantId }], payments: [{ tenderType: 'CASH', amountCents: 1 }],
    }).expect(404);
    const otherStore = (await api().post('/api/admin/stores').set(other()).send({ code: 'B1', name: 'Other store' }).expect(201)).body;
    const stores = (await api().get('/api/admin/stores').set(other()).expect(200)).body.stores;
    expect(stores.map((store: { id: string }) => store.id)).toEqual([otherStore.id]);
    const products = (await api().get('/api/admin/catalog/products').set(other()).expect(200)).body.products;
    expect(products).toHaveLength(0);
  });

  it('does not let a customer wallet go negative', async () => {
    const customer = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Wallet customer' }).expect(201)).body;
    await api().post(`/api/pos/v1/customers/${customer.id}/ledger`).set(auth()).send({ type: 'CREDIT', amountCents: 500 }).expect(201);
    await api().post(`/api/pos/v1/customers/${customer.id}/ledger`).set(auth()).send({ type: 'DEBIT', amountCents: 800 }).expect(400);
    const after = await api().post(`/api/pos/v1/customers/${customer.id}/ledger`).set(auth()).send({ type: 'DEBIT', amountCents: 200 }).expect(201);
    expect(after.body.walletBalanceCents).toBe(300);
  });
});

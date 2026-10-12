import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('Plan 2 pilot flow (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const api = () => request(app.getHttpServer());

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    const login = await api().post('/api/auth/login').send({ email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' }).expect(200);
    token = login.body.accessToken;
  });

  afterEach(async () => { await app.close(); });

  it('runs catalogue → register → checkout → inventory → refund → report', async () => {
    const seed = await api().post('/api/pos/v1/demo/seed').set('Authorization', `Bearer ${token}`).expect(201);
    const { storeId, registerId, variantId } = seed.body;
    const session = await api().post('/api/pos/v1/sessions').set('Authorization', `Bearer ${token}`).send({ storeId, registerId, openingFloatCents: 1000 }).expect(201);
    const search = await api().get('/api/pos/v1/catalog/search?q=MUG').set('Authorization', `Bearer ${token}`).expect(200);
    expect(search.body.products[0].variantId).toBe(variantId);
    expect(search.body.products[0]).toMatchObject({ brand: 'Demo', categoryName: 'Everyday', barcodes: ['890000000001'] });
    await api().patch(`/api/admin/catalog/variants/${variantId}`).set('Authorization', `Bearer ${token}`).send({ barcodes: ['890000000001', '890000000099'] }).expect(200);
    const alternateBarcode = await api().get('/api/pos/v1/catalog/search?q=890000000099').set('Authorization', `Bearer ${token}`).expect(200);
    expect(alternateBarcode.body.products[0].variantId).toBe(variantId);
    const sale = await api().post('/api/pos/v1/sales').set('Authorization', `Bearer ${token}`).send({ storeId, registerId, sessionId: session.body.id, clientSaleId: 'pilot-sale-1', lines: [{ variantId, quantity: 1 }], payments: [{ tenderType: 'CASH', amountCents: 49900 }] }).expect(201);
    expect(sale.body.sale.receiptNumber).toMatch(/^TAX-/);
    expect(sale.body.sale.totalCents).toBe(49900);
    const stockAfterSale = await api().get('/api/pos/v1/inventory').set('Authorization', `Bearer ${token}`).expect(200);
    expect(stockAfterSale.body.movements.some((movement: { type: string }) => movement.type === 'SALE')).toBe(true);
    const returned = await api().post('/api/pos/v1/returns').set('Authorization', `Bearer ${token}`).send({ saleId: sale.body.sale.id, sessionId: session.body.id, lines: [{ saleLineId: sale.body.sale.lines[0].id, quantity: 1 }], tenderType: 'CASH', restockStatus: 'DAMAGED', reason: 'Pilot return' }).expect(201);
    expect(returned.body.creditNoteNumber).toMatch(/^CN-/);
    const report = await api().get('/api/pos/v1/reports').set('Authorization', `Bearer ${token}`).expect(200);
    expect(report.body.sales.count).toBe(1);
    expect(report.body.returns.count).toBe(1);
    const closed = await api().post(`/api/pos/v1/sessions/${session.body.id}/close`).set('Authorization', `Bearer ${token}`).send({ countedCashCents: 1000 }).expect(201);
    expect(closed.body.status).toBe('CLOSED');
  });

  it('is idempotent on retried checkout and refuses a second open session', async () => {
    const seed = await api().post('/api/pos/v1/demo/seed').set('Authorization', `Bearer ${token}`).expect(201);
    const { storeId, registerId, variantId } = seed.body;
    const session = await api().post('/api/pos/v1/sessions').set('Authorization', `Bearer ${token}`).send({ storeId, registerId, openingFloatCents: 0 }).expect(201);
    await api().post('/api/pos/v1/sessions').set('Authorization', `Bearer ${token}`).send({ storeId, registerId, openingFloatCents: 0 }).expect(409);
    const body = { storeId, registerId, sessionId: session.body.id, clientSaleId: 'pilot-sale-idempotent', lines: [{ variantId, quantity: 1 }], payments: [{ tenderType: 'UPI', amountCents: 49900 }] };
    const first = await api().post('/api/pos/v1/sales').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    const second = await api().post('/api/pos/v1/sales').set('Authorization', `Bearer ${token}`).send(body).expect(201);
    expect(second.body.sale.id).toBe(first.body.sale.id);
  });
});

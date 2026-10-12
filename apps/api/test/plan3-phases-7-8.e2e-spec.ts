import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AlertScheduler } from '../src/pos/alert.scheduler.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };

describe('Plan 3 MVP phases 7–8 (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    token = (await api().post('/api/auth/login').send(ADMIN).expect(200)).body.accessToken;
  });

  afterEach(async () => { await app.close(); });

  it('reports GST, margin, tender, customer history, export and low-stock alerts', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    const customer = (await api().post('/api/pos/v1/customers').set(auth()).send({ name: 'Report Customer', phone: '9999999999' }).expect(201)).body;
    await api().post('/api/pos/v1/inventory/opening-stock/commit').set(auth()).send({ storeId: seed.storeId, rows: [{ sku: 'MUG-BLUE', quantity: 2, unitCostCents: 20000 }] }).expect(201);
    const locations = (await api().get('/api/pos/v1/locations').set(auth()).expect(200)).body.locations;
    await api().patch('/api/pos/v1/inventory/thresholds').set(auth()).send({ locationId: locations[0].id, variantId: seed.variantId, reorderPoint: 5, safetyStock: 2 }).expect(200);
    const session = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId }).expect(201)).body;
    const sale = (await api().post('/api/pos/v1/sales').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, sessionId: session.id, customerId: customer.id, lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CARD', amountCents: 49900 }] }).expect(201)).body.sale;

    const report = await api().get(`/api/pos/v1/reports?storeId=${seed.storeId}`).set(auth()).expect(200);
    expect(report.body.sales.count).toBeGreaterThanOrEqual(1);
    expect(report.body.gst).toEqual(expect.arrayContaining([expect.objectContaining({ rateBps: 500, taxCents: expect.any(Number) })]));
    expect(report.body.kpis.grossMarginCents).toBeGreaterThan(0);
    expect(report.body.cashReconciliation).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: session.id })]));

    const customerDetail = await api().get(`/api/pos/v1/customers/${customer.id}`).set(auth()).expect(200);
    expect(customerDetail.body.sales).toEqual(expect.arrayContaining([expect.objectContaining({ id: sale.id, receiptNumber: sale.receiptNumber })]));
    const csv = await api().get(`/api/pos/v1/reports/export?storeId=${seed.storeId}`).set(auth()).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('sales,totalCents');

    await app.get(AlertScheduler).sweep();
    const alerts = (await api().get('/api/pos/v1/alerts').set(auth()).expect(200)).body.alerts;
    expect(alerts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'LOW_STOCK', storeId: seed.storeId })]));
  });

  it('supports two partial returns, blocks over-return, and audits manager-approved cash refund drawer movement', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'ALLOW', approvalThresholds: { refundCents: 1000000 } }).expect(200);
    await api().post('/api/pos/v1/inventory/opening-stock/commit').set(auth()).send({ storeId: seed.storeId, rows: [{ sku: 'MUG-BLUE', quantity: 2 }] }).expect(201);
    const session = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, openingFloatCents: 0 }).expect(201)).body;
    const sale = (await api().post('/api/pos/v1/sales').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, sessionId: session.id, lines: [{ variantId: seed.variantId, quantity: 2 }], payments: [{ tenderType: 'CASH', amountCents: 99800, tenderedCents: 100000 }] }).expect(201)).body.sale;
    expect((await api().get(`/api/pos/v1/sessions/${session.id}/summary`).set(auth()).expect(200)).body.session.expectedCashCents).toBe(99800);

    const first = await api().post('/api/pos/v1/returns').set(auth()).send({ storeId: seed.storeId, saleId: sale.id, sessionId: session.id, lines: [{ saleLineId: sale.lines[0].id, quantity: 1, restockStatus: 'DAMAGED' }], tenderType: 'CASH', reason: 'First partial return' }).expect(201);
    expect(first.body.creditNoteNumber).toMatch(/^CN-/);
    await api().patch('/api/admin/settings').set(auth()).send({ approvalThresholds: { refundCents: 10000 } }).expect(200);

    const roles = (await api().get('/api/admin/roles').set(auth()).expect(200)).body.roles as { id: string; name: string }[];
    const managerRole = roles.find((role) => role.name === 'Store Manager');
    expect(managerRole).toBeDefined();
    const returnRole = (await api().post('/api/admin/roles').set(auth()).send({ name: `Return cashier ${Date.now()}`, permissions: ['refund.create'] }).expect(201)).body;
    const suffix = Date.now();
    const managerEmail = `return-manager-${suffix}@test.pos`;
    const cashierEmail = `return-cashier-${suffix}@test.pos`;
    await api().post('/api/admin/users').set(auth()).send({ email: managerEmail, password: 'Return-Manager-Password-2026!', firstName: 'Return', lastName: 'Manager', storeIds: [seed.storeId], roleAssignments: [{ roleId: managerRole!.id, scopeType: 'ORGANIZATION', scopeId: null }] }).expect(201);
    await api().post('/api/admin/users').set(auth()).send({ email: cashierEmail, password: 'Return-Cashier-Password-2026!', firstName: 'Return', lastName: 'Cashier', storeIds: [seed.storeId], roleAssignments: [{ roleId: returnRole.id, scopeType: 'STORE', scopeId: seed.storeId }] }).expect(201);
    const managerToken = (await api().post('/api/auth/login').send({ email: managerEmail, password: 'Return-Manager-Password-2026!' }).expect(200)).body.accessToken as string;
    await api().post('/api/auth/pin').set({ Authorization: `Bearer ${managerToken}` }).send({ pin: '2468' }).expect(204);
    const cashierToken = (await api().post('/api/auth/login').send({ email: cashierEmail, password: 'Return-Cashier-Password-2026!' }).expect(200)).body.accessToken as string;
    const cashierAuth = () => ({ Authorization: `Bearer ${cashierToken}` });

    const second = await api().post('/api/pos/v1/returns').set(cashierAuth()).send({ storeId: seed.storeId, saleId: sale.id, sessionId: session.id, lines: [{ saleLineId: sale.lines[0].id, quantity: 1, restockStatus: 'SELLABLE' }], tenderType: 'CASH', reason: 'Manager-approved final return', managerPin: '2468' }).expect(201);
    expect(second.body.creditNoteNumber).toMatch(/^CN-/);
    expect((await api().get(`/api/pos/v1/sessions/${session.id}/summary`).set(auth()).expect(200)).body.session.expectedCashCents).toBe(0);
    await api().post('/api/pos/v1/returns').set(auth()).send({ storeId: seed.storeId, saleId: sale.id, sessionId: session.id, lines: [{ saleLineId: sale.lines[0].id, quantity: 1 }], tenderType: 'CASH', reason: 'Over return' }).expect(400);
    const approvals = (await api().get(`/api/pos/v1/approvals?storeId=${seed.storeId}`).set(auth()).expect(200)).body.approvals;
    expect(approvals).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'RETURN_REFUND', status: 'APPROVED', referenceId: second.body.id })]));
  });
});

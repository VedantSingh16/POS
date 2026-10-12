import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('Plan 2 recommended flows (e2e)', () => {
  let app: INestApplication;
  let token: string;
  const api = () => request(app.getHttpServer());

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication(); await app.init();
    token = (await api().post('/api/auth/login').send({ email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' })).body.accessToken;
  });
  afterEach(async () => { await app.close(); });

  it('creates customers, coupons, locations and transfer lifecycle records', async () => {
    const seed = await api().post('/api/pos/v1/demo/seed').set('Authorization', `Bearer ${token}`).expect(201);
    const customer = await api().post('/api/pos/v1/customers').set('Authorization', `Bearer ${token}`).send({ name: 'Pilot Customer', phone: '9999999999', groupName: 'VIP' }).expect(201);
    const wallet = await api().post(`/api/pos/v1/customers/${customer.body.id}/ledger`).set('Authorization', `Bearer ${token}`).send({ type: 'CREDIT', amountCents: 1000 }).expect(201);
    expect(wallet.body.walletBalanceCents).toBe(1000);
    const promotion = await api().post('/api/pos/v1/promotions').set('Authorization', `Bearer ${token}`).send({ code: 'PILOT10', value: 10 }).expect(201);
    expect(promotion.body.code).toBe('PILOT10');
    const locations = await api().get('/api/pos/v1/locations').set('Authorization', `Bearer ${token}`).expect(200);
    const second = await api().post('/api/pos/v1/locations').set('Authorization', `Bearer ${token}`).send({ storeId: seed.body.storeId, code: 'BACKROOM', name: 'Back room' }).expect(201);
    const transfer = await api().post('/api/pos/v1/transfers').set('Authorization', `Bearer ${token}`).send({ fromLocationId: locations.body.locations[0].id, toLocationId: second.body.id, lines: [{ variantId: seed.body.variantId, quantity: 2 }], notes: 'Pilot transfer' }).expect(201);
    expect(transfer.body.status).toBe('REQUESTED');
    const moved = await api().patch(`/api/pos/v1/transfers/${transfer.body.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'IN_TRANSIT' }).expect(200);
    expect(moved.body.status).toBe('IN_TRANSIT');
  });

  it('holds and resumes a cart payload', async () => {
    const seed = await api().post('/api/pos/v1/demo/seed').set('Authorization', `Bearer ${token}`).expect(201);
    const held = await api().post('/api/pos/v1/holds').set('Authorization', `Bearer ${token}`).send({ storeId: seed.body.storeId, registerId: seed.body.registerId, clientHoldId: 'hold-1', payload: { lines: [{ variantId: seed.body.variantId, quantity: 1 }] } }).expect(201);
    const resumed = await api().post(`/api/pos/v1/holds/${held.body.id}/resume`).set('Authorization', `Bearer ${token}`).expect(201);
    expect(resumed.body.payload.lines[0].variantId).toBe(seed.body.variantId);
  });
});

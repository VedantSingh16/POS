import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('compact addresses and store hours (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `compact-hours-${Date.now()}`;
  const email = `compact-hours-${Date.now()}@example.com`;
  const api = () => request(app.getHttpServer());

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    if (prisma) await prisma.organization.deleteMany({ where: { slug } });
    await app.close();
  });

  it('accepts one compact store address without city fields and enforces configured hours', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({ organizationName: 'Compact Hours Test', organizationSlug: slug, firstName: 'Ada', lastName: 'Owner', email, password: 'Compact-Hours-Owner-2026!' }).expect(201);
    const auth = { Authorization: `Bearer ${registration.body.accessToken as string}` };
    const setup = await api().post('/api/admin/onboarding/required').set(auth).send({ organization: { name: 'Compact Hours Test', countryCode: 'IN', currency: 'INR', taxProfileStatus: 'NOT_REGISTERED' }, store: { name: 'Compact Store', address: 'One line market address', timezone: 'Asia/Kolkata' } }).expect(201);
    const storeId = setup.body.store.id as string;
    const registerId = setup.body.store.register.id as string;
    const storeAuth = { ...auth, 'x-store-id': storeId };

    const opened = await api().post('/api/pos/v1/sessions').set(storeAuth).send({ storeId, registerId, openingFloatCents: 1000 }).expect(201);
    expect(opened.body.expectedCashCents).toBe(1000);
    const admin = await prisma.user.findUniqueOrThrow({ where: { organizationId_email: { organizationId: registration.body.user.organizationId as string, email } } });
    const sale = await prisma.sale.create({ data: { organizationId: admin.organizationId, storeId, registerId, sessionId: opened.body.id as string, clientSaleId: `compact-sale-${Date.now()}`, receiptNumber: `COMPACT-${Date.now()}`, subtotalCents: 500, totalCents: 500, createdById: admin.id, payments: { create: { tenderType: 'CASH', amountCents: 500 } } } });
    expect(sale.totalCents).toBe(500);
    await api().post(`/api/pos/v1/sessions/${opened.body.id as string}/cash`).set(storeAuth).send({ type: 'PAID_IN', amountCents: 200, reason: 'Test cash in' }).expect(201);
    const closed = await api().post(`/api/pos/v1/sessions/${opened.body.id as string}/close`).set(storeAuth).send({ countedCashCents: 1700 }).expect(201);
    expect(closed.body.expectedCashCents).toBe(1700);
    expect(closed.body.varianceCents).toBe(0);

    const closedWeek = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null };
    await api().patch(`/api/admin/stores/${storeId}/settings`).set(auth).send({ operatingHours: closedWeek }).expect(200);
    const blocked = await api().post('/api/pos/v1/sessions').set(storeAuth).send({ storeId, registerId, openingFloatCents: 0 }).expect(400);
    expect(blocked.body.code).toBe('STORE_CLOSED');

    const alwaysOpen = { monday: { open: '00:01', close: '23:59' }, tuesday: { open: '00:01', close: '23:59' }, wednesday: { open: '00:01', close: '23:59' }, thursday: { open: '00:01', close: '23:59' }, friday: { open: '00:01', close: '23:59' }, saturday: { open: '00:01', close: '23:59' }, sunday: { open: '00:01', close: '23:59' } };
    await api().patch(`/api/admin/stores/${storeId}/settings`).set(auth).send({ operatingHours: alwaysOpen }).expect(200);
    await api().post('/api/pos/v1/sessions').set(storeAuth).send({ storeId, registerId, openingFloatCents: 0 }).expect(201);
    const saved = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { address: true, city: true, operatingHours: true } });
    expect(saved.address).toBe('One line market address');
    expect(saved.city).toBe('');
    expect(saved.operatingHours).toEqual(alwaysOpen);
  });
});

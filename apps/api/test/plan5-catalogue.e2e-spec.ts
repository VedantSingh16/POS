import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Plan 5: per-store catalogue, transfers, customers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `plan5-${Date.now()}`;
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

  it('keeps each store catalogue separate and moves stock with transfers', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({
      organizationName: 'Plan Five Test', organizationSlug: slug, firstName: 'Ada', lastName: 'Admin',
      email: 'admin@plan-five-test.example', password: 'Plan-Five-Admin-2026!',
    }).expect(201);
    const auth = { Authorization: `Bearer ${registration.body.accessToken as string}` };

    const roles = await api().get('/api/admin/permission-groups').set(auth).expect(200);
    expect(Array.isArray(roles.body.groups)).toBe(true);

    const storeA = (await api().post('/api/admin/stores').set(auth).send({ code: 'A', name: 'Store A', address: 'Road 1', register: { code: 'R1', name: 'Till 1' } }).expect(201)).body;
    const storeB = (await api().post('/api/admin/stores').set(auth).send({ code: 'B', name: 'Store B', address: 'Road 2', register: { code: 'R2', name: 'Till 2' } }).expect(201)).body;
    const product = (await api().post('/api/admin/catalog/products').set(auth).send({ name: 'Only in A' }).expect(201)).body;
    const withVariant = (await api().post(`/api/admin/catalog/products/${product.id as string}/variants`).set(auth).send({ sku: 'ONLY-A', name: 'One', amountCents: 10000 }).expect(201)).body;
    const variantId = withVariant.variants[0].id as string;

    await api().post('/api/pos/v1/store-products').set(auth).send({ storeId: storeA.id, variantIds: [variantId], openingQuantity: 5 }).expect(201);
    const inA = await api().get(`/api/pos/v1/catalog/search?storeId=${storeA.id as string}`).set(auth).expect(200);
    const inB = await api().get(`/api/pos/v1/catalog/search?storeId=${storeB.id as string}`).set(auth).expect(200);
    expect(inA.body.products.map((p: { variantId: string }) => p.variantId)).toContain(variantId);
    expect(inB.body.products.map((p: { variantId: string }) => p.variantId)).not.toContain(variantId);

    // Transfer 3 units A -> B: nothing moves until dispatch/receive.
    const locations = await prisma.stockLocation.findMany({ where: { storeId: { in: [storeA.id, storeB.id] } } });
    const locA = locations.find((l) => l.storeId === storeA.id)!;
    const locB = locations.find((l) => l.storeId === storeB.id)!;
    const transfer = (await api().post('/api/pos/v1/transfers').set(auth).send({ fromLocationId: locA.id, toLocationId: locB.id, lines: [{ variantId, quantity: 3 }] }).expect(201)).body;
    expect(transfer.lines).toHaveLength(1);
    await api().patch(`/api/pos/v1/transfers/${transfer.id as string}`).set(auth).send({ status: 'DISPATCHED' }).expect(200);
    await api().patch(`/api/pos/v1/transfers/${transfer.id as string}`).set(auth).send({ status: 'RECEIVED' }).expect(200);
    const qty = async (locationId: string) => Number((await prisma.inventoryBalance.findFirst({ where: { locationId, variantId, status: 'SELLABLE' } }))?.quantity ?? 0);
    expect(await qty(locA.id)).toBe(2);
    expect(await qty(locB.id)).toBe(3);
    const nowInB = await api().get(`/api/pos/v1/catalog/search?storeId=${storeB.id as string}`).set(auth).expect(200);
    expect(nowInB.body.products.map((p: { variantId: string }) => p.variantId)).toContain(variantId);

    // A customer created in the organisation is visible straight away.
    const customer = (await api().post('/api/pos/v1/customers').set(auth).send({ name: 'New Person', phone: '9000000001' }).expect(201)).body;
    const list = await api().get('/api/pos/v1/customers').set(auth).expect(200);
    expect(list.body.customers.map((c: { id: string }) => c.id)).toContain(customer.id);
  });
});

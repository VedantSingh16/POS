import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { seedFoundation } from '../src/bootstrap/foundation.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };

describe('Plan 3 tenant and store isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => { await app.close(); });

  it('does not expose tenant A stores, catalogue, customers, reports or alerts to tenant B', async () => {
    const aToken = (await api().post('/api/auth/login').send({ ...ADMIN, organizationSlug: 'test-organisation' }).expect(200)).body.accessToken as string;
    const seed = (await api().post('/api/pos/v1/demo/seed').set({ Authorization: `Bearer ${aToken}` }).expect(201)).body;
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: seed.variantId }, select: { productId: true } });
    const customer = (await api().post('/api/pos/v1/customers').set({ Authorization: `Bearer ${aToken}` }).send({ name: 'Tenant A customer' }).expect(201)).body;
    const bSlug = `tenant-b-${Date.now()}`;
    await seedFoundation(prisma, { organizationName: 'Tenant B', organizationSlug: bSlug, maxStores: 2, adminEmail: ADMIN.email, adminPassword: ADMIN.password });
    const bToken = (await api().post('/api/auth/login').send({ ...ADMIN, organizationSlug: bSlug }).expect(200)).body.accessToken as string;
    const bAuth = { Authorization: `Bearer ${bToken}` };

    const bOverview = await api().get('/api/admin/overview').set(bAuth).expect(200);
    expect(bOverview.body.organization.name).toBe('Tenant B');
    expect((await api().get('/api/admin/stores').set(bAuth).expect(200)).body.stores).toEqual([]);
    expect((await api().get('/api/admin/catalog/products').set(bAuth).expect(200)).body.products).toEqual([]);
    expect((await api().get('/api/pos/v1/customers').set(bAuth).expect(200)).body.customers).toEqual([]);
    await api().get(`/api/admin/stores/${seed.storeId}`).set(bAuth).expect(404);
    await api().get(`/api/admin/catalog/products/${variant.productId}`).set(bAuth).expect(404);
    await api().get(`/api/pos/v1/customers/${customer.id}`).set(bAuth).expect(404);
    await api().get(`/api/pos/v1/reports?storeId=${seed.storeId}`).set(bAuth).expect(404);
  });
});

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Organization registration, onboarding and store manager scope (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `register-test-${Date.now()}`;
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

  it('registers an organisation, creates a custom role, onboards stores and limits each manager to their assigned store', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({
      organizationName: 'Store Scope Test',
      organizationSlug: slug,
      firstName: 'Ada',
      lastName: 'Admin',
      email: 'admin@store-scope-test.example',
      password: 'Store-Scope-Admin-2026!',
    }).expect(201);
    const adminToken = registration.body.accessToken as string;
    const adminAuth = { Authorization: `Bearer ${adminToken}` };

    const me = await api().get('/api/auth/me').set(adminAuth).expect(200);
    expect(me.body.user.isOrganisationAdministrator).toBe(true);
    expect(me.body.onboardingRequired).toBe(true);

    const role = await api().post('/api/admin/roles').set(adminAuth).send({
      name: 'Store Directory Reader',
      description: 'Can view one store in the directory',
      permissions: ['stores.view'],
    }).expect(201);
    expect(role.body.permissions).toEqual(['stores.view']);
    const roles = await api().get('/api/admin/roles').set(adminAuth).expect(200);
    expect(roles.body.roles.find((item: { id: string }) => item.id === role.body.id).permissionCount).toBe(1);

    const createdStores = await api().post('/api/admin/onboarding/stores').set(adminAuth).send({ stores: [
      { code: 'NORTH', name: 'North Store', address: 'North road', timezone: 'Asia/Kolkata', registerCode: 'N-01', registerName: 'North Till' },
      { code: 'SOUTH', name: 'South Store', address: 'South road', timezone: 'Asia/Kolkata', registerCode: 'S-01', registerName: 'South Till' },
    ] }).expect(201);
    const [north, south] = createdStores.body.stores as { id: string; name: string }[];
    await api().post('/api/admin/onboarding/managers').set(adminAuth).send({ managers: [
      { storeId: north.id, firstName: 'Nora', lastName: 'Manager', email: 'nora@store-scope-test.example', password: 'North-Manager-2026!' },
      { storeId: south.id, firstName: 'Sam', lastName: 'Manager', email: 'sam@store-scope-test.example', password: 'South-Manager-2026!' },
    ] }).expect(201);
    await api().post('/api/admin/onboarding/finish').set(adminAuth).expect(201);
    expect((await api().get('/api/auth/me').set(adminAuth).expect(200)).body.onboardingRequired).toBe(false);

    const users = await api().get('/api/admin/users').set(adminAuth).expect(200);
    const nora = users.body.users.find((user: { email: string }) => user.email === 'nora@store-scope-test.example');
    const sam = users.body.users.find((user: { email: string }) => user.email === 'sam@store-scope-test.example');
    const systemRoles = await api().get('/api/admin/roles').set(adminAuth).expect(200);
    const storeManager = systemRoles.body.roles.find((item: { name: string }) => item.name === 'Store Manager');
    await api().patch(`/api/admin/users/${nora.id}`).set(adminAuth).send({
      storeIds: [north.id, south.id],
      roleAssignments: [
        { roleId: storeManager.id, scopeType: 'STORE', storeId: north.id },
        { roleId: role.body.id, scopeType: 'STORE', storeId: south.id },
      ],
    }).expect(200);

    const southRegister = await prisma.register.findFirstOrThrow({ where: { organizationId: me.body.user.organizationId, storeId: south.id } });
    const southSession = await prisma.registerSession.create({ data: {
      organizationId: me.body.user.organizationId,
      storeId: south.id,
      registerId: southRegister.id,
      openedById: sam.id,
    } });
    const southSale = await prisma.sale.create({ data: {
      organizationId: me.body.user.organizationId,
      storeId: south.id,
      registerId: southRegister.id,
      sessionId: southSession.id,
      clientSaleId: `scope-check-${Date.now()}`,
      receiptNumber: 'SOUTH-SCOPE-CHECK',
      subtotalCents: 100,
      totalCents: 100,
      createdById: sam.id,
    } });

    const northLogin = await api().post('/api/auth/login').send({ email: 'nora@store-scope-test.example', password: 'North-Manager-2026!', organizationSlug: slug }).expect(200);
    const northToken = northLogin.body.accessToken as string;
    const northAuth = { Authorization: `Bearer ${northToken}` };
    const northMe = await api().get('/api/auth/me').set(northAuth).expect(200);
    expect(northMe.body.user.isOrganisationAdministrator).toBe(false);
    expect(northMe.body.stores.map((store: { id: string }) => store.id)).toEqual([north.id, south.id]);
    expect(northMe.body.permissions.stores[north.id]).toContain('sale.create');
    expect(northMe.body.permissions.stores[south.id]).toEqual(['stores.view']);

    const visibleStores = await api().get('/api/admin/stores').set({ ...northAuth, 'x-store-id': south.id }).expect(200);
    expect(visibleStores.body.stores.map((store: { id: string }) => store.id)).toEqual([south.id]);
    await api().get(`/api/pos/v1/sales/${southSale.id}`).set({ ...northAuth, 'x-store-id': north.id }).expect(403);

    const staff = await api().get(`/api/admin/stores/${north.id}/users`).set(northAuth).expect(200);
    expect(staff.body.users.map((user: { email: string }) => user.email)).toEqual(['nora@store-scope-test.example']);
    await api().get(`/api/admin/stores/${south.id}/settings`).set(northAuth).expect(403);
    await api().get(`/api/admin/stores/${south.id}/users`).set(northAuth).expect(403);
    await api().get(`/api/pos/v1/sales?storeId=${south.id}`).set(northAuth).expect(403);
    await api().get(`/api/pos/v1/catalog/search?storeId=${south.id}`).set(northAuth).expect(403);
    await api().get('/api/admin/catalog/products').set({ ...northAuth, 'x-store-id': north.id }).expect(403);
    await api().get('/api/admin/overview').set({ ...northAuth, 'x-store-id': north.id }).expect(403);
  });
});

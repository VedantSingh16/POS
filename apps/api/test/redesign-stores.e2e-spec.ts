import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Store directory: real manager, staff and register data (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `redesign-stores-${Date.now()}`;
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

  it('creates a till with a new store and reports managers, staff and registers per store', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({
      organizationName: 'Store Directory Test', organizationSlug: slug, firstName: 'Ada', lastName: 'Admin',
      email: 'admin@store-directory-test.example', password: 'Store-Directory-Admin-2026!',
    }).expect(201);
    const adminAuth = { Authorization: `Bearer ${registration.body.accessToken as string}` };

    const east = await api().post('/api/admin/stores').set(adminAuth).send({ code: 'EAST', name: 'East Store', address: 'East road', register: { code: 'E-01', name: 'East Till' } }).expect(201);
    expect(east.body.registers.map((register: { code: string }) => register.code)).toEqual(['E-01']);
    const west = await api().post('/api/admin/stores').set(adminAuth).send({ code: 'WEST', name: 'West Store', address: 'West road' }).expect(201);
    expect(west.body.registers).toHaveLength(0);

    const roles = await api().get('/api/admin/roles').set(adminAuth).expect(200);
    const storeManager = roles.body.roles.find((role: { name: string }) => role.name === 'Store Manager');
    await api().post('/api/admin/users').set(adminAuth).send({
      firstName: 'Eve', lastName: 'Manager', email: 'eve@store-directory-test.example', password: 'East-Manager-2026!',
      storeIds: [east.body.id], roleAssignments: [{ roleId: storeManager.id, scopeType: 'STORE', storeId: east.body.id }],
    }).expect(201);

    const list = await api().get('/api/admin/stores').set(adminAuth).expect(200);
    const eastRow = list.body.stores.find((store: { id: string }) => store.id === east.body.id);
    const westRow = list.body.stores.find((store: { id: string }) => store.id === west.body.id);
    expect(eastRow.registerCount).toBe(1);
    expect(eastRow.staffCount).toBe(1);
    expect(eastRow.managers.map((manager: { email: string }) => manager.email)).toEqual(['eve@store-directory-test.example']);
    expect(westRow.registerCount).toBe(0);
    expect(westRow.staffCount).toBe(0);
    expect(westRow.managers).toEqual([]);

    // The role roster lists the real number of people holding each role.
    const afterRoles = await api().get('/api/admin/roles').set(adminAuth).expect(200);
    const managerRole = afterRoles.body.roles.find((role: { name: string }) => role.name === 'Store Manager');
    expect(managerRole.userCount).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(managerRole.permissionCount)).toBe(true);

    // A store manager is confined to their store and cannot administer the organisation's stores.
    const login = await api().post('/api/auth/login').send({ email: 'eve@store-directory-test.example', password: 'East-Manager-2026!', organizationSlug: slug }).expect(200);
    const eveAuth = { Authorization: `Bearer ${login.body.accessToken as string}` };
    await api().post('/api/admin/stores').set(eveAuth).send({ code: 'NORTH', name: 'North', address: 'N' }).expect(403);
    await api().patch(`/api/admin/stores/${east.body.id}`).set(eveAuth).send({ status: 'INACTIVE' }).expect(403);
    await api().get(`/api/admin/stores/${west.body.id}/users`).set(eveAuth).expect(403);
    await api().get('/api/admin/users').set(eveAuth).expect(403);
  });
});

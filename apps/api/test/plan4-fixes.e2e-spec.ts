import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Plan 4 fixes: credentials and demo data (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const slug = `plan4-fixes-${Date.now()}`;
  const api = () => request(app.getHttpServer());
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv;
    if (prisma) await prisma.organization.deleteMany({ where: { slug } });
    await app.close();
  });

  it('requires the current password to change a password, lets an administrator reset a team password, and blocks demo seed in production', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({
      organizationName: 'Plan Four Test', organizationSlug: slug, firstName: 'Ada', lastName: 'Admin',
      email: 'admin@plan-four-test.example', password: 'Plan-Four-Admin-2026!',
    }).expect(201);
    const auth = { Authorization: `Bearer ${registration.body.accessToken as string}` };

    // Changing a password without proving the old one is refused; with it, the new password works.
    await api().patch('/api/auth/profile').set(auth).send({ password: 'Another-Long-Password-1!' }).expect(401);
    await api().patch('/api/auth/profile').set(auth).send({ password: 'Another-Long-Password-1!', currentPassword: 'wrong-password-value' }).expect(401);
    await api().patch('/api/auth/profile').set(auth).send({ password: 'Another-Long-Password-1!', currentPassword: 'Plan-Four-Admin-2026!' }).expect(200);
    await api().post('/api/auth/login').send({ email: 'admin@plan-four-test.example', password: 'Another-Long-Password-1!', organizationSlug: slug }).expect(201);

    // Administrator-set reset for a team member.
    const store = await api().post('/api/admin/stores').set(auth).send({ code: 'MAIN1', name: 'Main', address: 'Road 1', register: { code: 'R1', name: 'Till 1' } }).expect(201);
    const roles = await api().get('/api/admin/roles').set(auth).expect(200);
    const cashier = roles.body.roles.find((role: { name: string }) => role.name === 'Cashier');
    const created = await api().post('/api/admin/users').set(auth).send({
      firstName: 'Cy', lastName: 'Cashier', email: 'cy@plan-four-test.example', password: 'Initial-Cashier-2026!',
      storeIds: [store.body.id], roleAssignments: [{ roleId: cashier.id, scopeType: 'STORE', storeId: store.body.id }],
    }).expect(201);
    await api().patch(`/api/admin/users/${created.body.id as string}`).set(auth).send({ password: 'short' }).expect(400);
    await api().patch(`/api/admin/users/${created.body.id as string}`).set(auth).send({ password: 'Reset-Cashier-Pass-2026!' }).expect(200);
    await api().post('/api/auth/login').send({ email: 'cy@plan-four-test.example', password: 'Reset-Cashier-Pass-2026!', organizationSlug: slug }).expect(201);

    // Demo seed is off in production unless explicitly allowed.
    process.env.NODE_ENV = 'production';
    await api().post('/api/pos/v1/demo/seed').set(auth).expect(403);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { seedFoundation } from './../src/bootstrap/foundation.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };
const USER_PASSWORD = 'Another-Strong-Password-1!';

describe('Phase 2: sessions, access control and lockout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string, storeId?: string) => ({ Authorization: `Bearer ${token}`, ...(storeId ? { 'x-store-id': storeId } : {}) });

  type World = { storeA: string; storeB: string; registerA: string; registerB: string; tokens: Record<'admin' | 'manager' | 'cashier' | 'inventory', string> };
  async function buildWorld(): Promise<World> {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(bearer(adminToken)).expect(201)).body;
    const storeB = (await api().post('/api/admin/stores').set(bearer(adminToken)).send({ code: 'SECOND', name: 'Second store' }).expect(201)).body;
    const registerB = (await api().post(`/api/admin/stores/${storeB.id}/registers`).set(bearer(adminToken)).send({ code: 'B1', name: 'Till B1' }).expect(201)).body;
    const roles = (await api().get('/api/admin/roles').set(bearer(adminToken)).expect(200)).body.roles as { id: string; name: string }[];
    const roleId = (name: string) => roles.find((r) => r.name === name)!.id;
    const make = async (email: string, roleName: string) => {
      await api().post('/api/admin/users').set(bearer(adminToken)).send({
        email, password: USER_PASSWORD, firstName: roleName, storeIds: [seed.storeId],
        roleAssignments: [{ roleId: roleId(roleName), scopeType: 'STORE', scopeId: seed.storeId }],
      }).expect(201);
      return (await api().post('/api/auth/login').send({ email, password: USER_PASSWORD }).expect(200)).body.accessToken as string;
    };
    return {
      storeA: seed.storeId, storeB: storeB.id, registerA: seed.registerId, registerB: registerB.id,
      tokens: { admin: adminToken, manager: await make('manager@test.pos', 'Store Manager'), cashier: await make('cashier@test.pos', 'Cashier'), inventory: await make('inventory@test.pos', 'Inventory User') },
    };
  }

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    adminToken = (await api().post('/api/auth/login').send(ADMIN).expect(200)).body.accessToken;
  });
  afterEach(async () => { await app.close(); });

  it('/auth/me returns organisation, roles, permissions per scope and only reachable stores', async () => {
    const w = await buildWorld();
    const admin = (await api().get('/api/auth/me').set(bearer(w.tokens.admin)).expect(200)).body;
    expect(admin.organisation).toMatchObject({ name: 'Test Organisation', slug: 'test-organisation' });
    expect(admin.permissions.organization).toContain('stores.manage');
    expect(admin.stores.map((s: { id: string }) => s.id).sort()).toEqual([w.storeA, w.storeB].sort());

    const cashier = (await api().get('/api/auth/me').set(bearer(w.tokens.cashier)).expect(200)).body;
    expect(cashier.stores.map((s: { id: string }) => s.id)).toEqual([w.storeA]);
    expect(cashier.permissions.organization).toEqual([]);
    expect(cashier.permissions.stores[w.storeA]).toEqual(expect.arrayContaining(['sale.create', 'register.open']));
    expect(cashier.permissions.stores[w.storeA]).not.toContain('users.manage');
    expect(cashier.roles).toEqual([{ name: 'Cashier', scopeType: 'STORE', storeId: w.storeA }]);
    expect(JSON.stringify(cashier)).not.toMatch(/passwordHash|pinHash/);
  });

  // user × route × store → status. "other" is a store the user has no assignment for.
  it('decides access by role and store across real routes', async () => {
    const w = await buildWorld();
    const roles = ['admin', 'manager', 'cashier', 'inventory'] as const;
    type Case = { name: string; call: (token: string, storeId: string, registerId: string) => request.Test; own: Record<(typeof roles)[number], number>; other: Record<(typeof roles)[number], number> };
    const cases: Case[] = [
      { name: 'view registers', call: (t, s) => api().get('/api/pos/v1/sessions').set(bearer(t, s)),
        own: { admin: 200, manager: 200, cashier: 200, inventory: 403 }, other: { admin: 200, manager: 403, cashier: 403, inventory: 403 } },
      { name: 'store overview', call: (t, s) => api().get('/api/pos/v1/overview').set(bearer(t, s)),
        own: { admin: 200, manager: 200, cashier: 403, inventory: 403 }, other: { admin: 200, manager: 403, cashier: 403, inventory: 403 } },
      { name: 'search catalogue', call: (t, s) => api().get('/api/pos/v1/catalog/search?q=a').set(bearer(t, s)),
        own: { admin: 200, manager: 200, cashier: 200, inventory: 200 }, other: { admin: 200, manager: 403, cashier: 403, inventory: 403 } },
      { name: 'open register session', call: (t, s, r) => api().post('/api/pos/v1/sessions').set(bearer(t, s)).send({ storeId: s, registerId: r, openingFloatCents: 0 }),
        own: { admin: 201, manager: 201, cashier: 201, inventory: 403 }, other: { admin: 201, manager: 403, cashier: 403, inventory: 403 } },
      { name: 'create a sale', call: (t, s, r) => api().post('/api/pos/v1/sales').set(bearer(t, s)).send({ storeId: s, registerId: r, lines: [], payments: [] }),
        own: { admin: 400, manager: 400, cashier: 400, inventory: 403 }, other: { admin: 400, manager: 403, cashier: 403, inventory: 403 } },
      { name: 'manage users', call: (t, s) => api().post('/api/admin/users').set(bearer(t, s)).send({}),
        own: { admin: 400, manager: 403, cashier: 403, inventory: 403 }, other: { admin: 400, manager: 403, cashier: 403, inventory: 403 } },
      { name: 'create a store', call: (t) => api().post('/api/admin/stores').set(bearer(t)).send({}),
        own: { admin: 400, manager: 403, cashier: 403, inventory: 403 }, other: { admin: 400, manager: 403, cashier: 403, inventory: 403 } },
    ];
    const failures: string[] = [];
    for (const c of cases) {
      for (const role of roles) {
        // Own store: close any session a previous case opened so the register is free again.
        const own = await c.call(w.tokens[role], w.storeA, w.registerA);
        if (own.status !== c.own[role]) failures.push(`${c.name} / ${role} / own store: expected ${c.own[role]}, got ${own.status}`);
        const other = await c.call(w.tokens[role], w.storeB, w.registerB);
        if (other.status !== c.other[role]) failures.push(`${c.name} / ${role} / other store: expected ${c.other[role]}, got ${other.status}`);
        await prisma.registerSession.deleteMany({ where: { status: 'OPEN' } });
      }
    }
    expect(failures).toEqual([]);
  });

  it('rejects requests without a valid session', async () => {
    await api().get('/api/auth/me').expect(401);
    await api().get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token').expect(401);
  });

  it('logout invalidates the session', async () => {
    await api().post('/api/auth/logout').set(bearer(adminToken)).expect(204);
    await api().get('/api/auth/me').set(bearer(adminToken)).expect(401);
  });

  it('expires a session after the idle window', async () => {
    await prisma.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 61 * 60_000) } });
    await api().get('/api/auth/me').set(bearer(adminToken)).expect(401);
  });

  it('locks the account after five failures, audits the lockout and recovers after the lock window', async () => {
    for (let i = 0; i < 5; i += 1) await api().post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-password' }).expect(401);
    const audited = await prisma.auditLog.findMany({ where: { action: 'auth.lockout', organization: { slug: 'test-organisation' } } });
    expect(audited).toHaveLength(1);
    await api().post('/api/auth/login').send(ADMIN).expect(401); // correct password is refused while locked
    await prisma.user.updateMany({ where: { email: ADMIN.email }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await api().post('/api/auth/login').send(ADMIN).expect(200);
  });

  it('unlocks a till with the signed-in user\'s PIN and counts wrong PINs toward lockout', async () => {
    await api().post('/api/auth/pin').set(bearer(adminToken)).send({ pin: '2468' }).expect(204);
    await api().post('/api/auth/unlock').set(bearer(adminToken)).send({ pin: '2468' }).expect(204);
    for (let i = 0; i < 5; i += 1) await api().post('/api/auth/unlock').set(bearer(adminToken)).send({ pin: '0000' }).expect(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.lockout', organization: { slug: 'test-organisation' } } })).toBe(1);
    await api().post('/api/auth/unlock').set(bearer(adminToken)).send({ pin: '2468' }).expect(401); // locked
  });

  it('asks for the organisation only after the password proves the email, and never leaks it otherwise', async () => {
    await seedFoundation(prisma, { organizationName: 'Other Organisation', organizationSlug: 'test-organisation-b', maxStores: 3, adminEmail: ADMIN.email, adminPassword: ADMIN.password });
    const ambiguous = await api().post('/api/auth/login').send(ADMIN).expect(409);
    expect(ambiguous.body.code).toBe('ORGANISATION_REQUIRED');
    expect(ambiguous.body.organisations.map((o: { slug: string }) => o.slug).sort()).toEqual(['test-organisation', 'test-organisation-b']);
    const wrong = await api().post('/api/auth/login').send({ email: ADMIN.email, password: 'nope-nope-nope' }).expect(401);
    expect(JSON.stringify(wrong.body)).not.toContain('test-organisation');
    const picked = await api().post('/api/auth/login').send({ ...ADMIN, organizationSlug: 'test-organisation-b' }).expect(200);
    const me = (await api().get('/api/auth/me').set(bearer(picked.body.accessToken)).expect(200)).body;
    expect(me.organisation.slug).toBe('test-organisation-b');
  });

  it('returns a distinct REQUIRE_APPROVAL 403 when a discount exceeds the policy', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(bearer(adminToken)).expect(201)).body;
    const session = (await api().post('/api/pos/v1/sessions').set(bearer(adminToken)).send({ storeId: seed.storeId, registerId: seed.registerId, openingFloatCents: 0 }).expect(201)).body;
    const policy = await prisma.approvalPolicy.findFirst({ where: { action: 'SALE_DISCOUNT' } });
    expect(policy).not.toBeNull();
    const res = await api().post('/api/pos/v1/sales').set(bearer(adminToken)).send({
      storeId: seed.storeId, registerId: seed.registerId, sessionId: session.id, discountCents: 49900,
      lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CASH', amountCents: 1 }],
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'REQUIRE_APPROVAL', action: 'SALE_DISCOUNT' });
  });
});

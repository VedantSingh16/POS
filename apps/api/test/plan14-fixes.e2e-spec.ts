import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };
const PASSWORD = 'Plan14-Strong-Password-1!';

describe('Plan 14: store codes, categories, held sales and store staff (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string, storeId?: string) => ({ Authorization: `Bearer ${token}`, ...(storeId ? { 'x-store-id': storeId } : {}) });
  const login = async (email: string, password = PASSWORD) => (await api().post('/api/auth/login').send({ email, password }).expect(200)).body.accessToken as string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    adminToken = await login(ADMIN.email, ADMIN.password);
  });
  afterEach(async () => { await app.close(); });

  async function roleId(name: string) {
    const roles = (await api().get('/api/admin/roles').set(bearer(adminToken)).expect(200)).body.roles as { id: string; name: string }[];
    return roles.find((role) => role.name === name)!.id;
  }

  async function createPerson(email: string, roleName: string, storeIds: string[]) {
    const id = await roleId(roleName);
    await api().post('/api/admin/users').set(bearer(adminToken)).send({
      email, password: PASSWORD, firstName: roleName, storeIds,
      roleAssignments: storeIds.map((storeId) => ({ roleId: id, scopeType: 'STORE', scopeId: storeId })),
    }).expect(201);
    return login(email);
  }

  it('generates the store code when none is given and keeps accepting an explicit one', async () => {
    const before = (await api().get('/api/admin/stores').set(bearer(adminToken)).expect(200)).body.stores as { code: string }[];
    const created = (await api().post('/api/admin/stores').set(bearer(adminToken)).send({ name: 'Auto Code Store', address: 'Way 1, Muscat' }).expect(201)).body;
    expect(created.code).toMatch(/^STORE-\d{2}$/);
    expect(before.map((store) => store.code)).not.toContain(created.code);
    const stockroom = (await api().get(`/api/admin/stores/${created.id}`).set(bearer(adminToken)).expect(200)).body;
    expect(stockroom.code).toBe(created.code);
  });

  it('cascades disabling to every subcategory and deletes only unused category trees', async () => {
    const create = async (name: string, parentId: string | null = null) => (await api().post('/api/admin/catalog/categories').set(bearer(adminToken)).send({ name, parentId }).expect(201)).body.id as string;
    const statuses = async () => Object.fromEntries(((await api().get('/api/admin/catalog/categories').set(bearer(adminToken)).expect(200)).body.categories as { id: string; status: string }[]).map((category) => [category.id, category.status]));
    const cakes = await create('Cakes');
    const chocolate = await create('Chocolate', cakes);
    const darkChocolate = await create('Dark chocolate', chocolate);
    const vanilla = await create('Vanilla', cakes);

    await api().patch(`/api/admin/catalog/categories/${cakes}`).set(bearer(adminToken)).send({ status: 'DISABLED' }).expect(200);
    let status = await statuses();
    expect([status[cakes], status[chocolate], status[darkChocolate], status[vanilla]]).toEqual(['DISABLED', 'DISABLED', 'DISABLED', 'DISABLED']);

    // A subcategory cannot be switched back on, or moved, while its parent stays disabled.
    await api().patch(`/api/admin/catalog/categories/${vanilla}`).set(bearer(adminToken)).send({ status: 'ACTIVE' }).expect(400);
    const loose = await create('Loose');
    await api().patch(`/api/admin/catalog/categories/${loose}`).set(bearer(adminToken)).send({ parentId: cakes }).expect(200);
    expect((await statuses())[loose]).toBe('DISABLED');

    // Re-enabling the parent touches only the parent, unless subcategories are explicitly included.
    await api().patch(`/api/admin/catalog/categories/${cakes}`).set(bearer(adminToken)).send({ status: 'ACTIVE' }).expect(200);
    status = await statuses();
    expect([status[cakes], status[chocolate], status[vanilla]]).toEqual(['ACTIVE', 'DISABLED', 'DISABLED']);
    await api().patch(`/api/admin/catalog/categories/${cakes}`).set(bearer(adminToken)).send({ status: 'DISABLED' }).expect(200);
    await api().patch(`/api/admin/catalog/categories/${cakes}`).set(bearer(adminToken)).send({ status: 'ACTIVE', includeSubcategories: true }).expect(200);
    status = await statuses();
    expect([status[cakes], status[chocolate], status[darkChocolate], status[vanilla]]).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE']);

    // Delete: an empty tree goes in one step; a tree with a product anywhere below is refused.
    await api().delete(`/api/admin/catalog/categories/${chocolate}`).set(bearer(adminToken)).expect(200);
    status = await statuses();
    expect(status[chocolate]).toBeUndefined();
    expect(status[darkChocolate]).toBeUndefined();
    const audit = (await api().get('/api/admin/audit').set(bearer(adminToken)).expect(200)).body.audit as { action: string }[];
    expect(audit.map((entry) => entry.action)).toContain('category.deleted');

    const seed = (await api().post('/api/pos/v1/demo/seed').set(bearer(adminToken)).expect(201)).body;
    const product = (await api().get(`/api/admin/catalog/products`).set(bearer(adminToken)).expect(200)).body.products.find((item: { variants?: { id: string }[] }) => item.variants?.some((variant) => variant.id === seed.variantId)) as { id: string; categoryId: string };
    await api().patch(`/api/admin/catalog/products/${product.id}`).set(bearer(adminToken)).send({ categoryId: vanilla }).expect(200);
    await api().delete(`/api/admin/catalog/categories/${cakes}`).set(bearer(adminToken)).expect(409);
    expect((await statuses())[cakes]).toBe('ACTIVE');
  });

  it('stores a cleaned description on a held sale and lists item names and the total', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(bearer(adminToken)).expect(201)).body;
    const manager = await createPerson('hold-manager@test.pos', 'Store Manager', [seed.storeId]);
    const held = (await api().post('/api/pos/v1/holds').set(bearer(manager, seed.storeId)).send({
      storeId: seed.storeId, registerId: seed.registerId,
      payload: { description: `  Customer   in   blue shirt ${'x'.repeat(200)}`, estimatedTotalCents: 6000, lines: [{ variantId: seed.variantId, quantity: 6 }] },
    }).expect(201)).body;
    expect(held.payload.description).toHaveLength(120);
    expect(held.payload.description.startsWith('Customer in blue shirt')).toBe(true);

    const holds = (await api().get(`/api/pos/v1/holds?storeId=${seed.storeId}`).set(bearer(manager, seed.storeId)).expect(200)).body.holds as { id: string; description: string; itemsPreview: string; lineCount: number; itemCount: number; estimatedTotalCents: number }[];
    const listed = holds.find((entry) => entry.id === held.id)!;
    expect(listed).toMatchObject({ lineCount: 1, itemCount: 6, estimatedTotalCents: 6000 });
    expect(listed.description.startsWith('Customer in blue shirt')).toBe(true);
    expect(listed.itemsPreview).toMatch(/ × 6$/);

    // Bad estimates are dropped rather than stored.
    const noEstimate = (await api().post('/api/pos/v1/holds').set(bearer(manager, seed.storeId)).send({ storeId: seed.storeId, registerId: seed.registerId, payload: { estimatedTotalCents: -5, lines: [{ variantId: seed.variantId, quantity: 1 }] } }).expect(201)).body;
    expect(noEstimate.payload.estimatedTotalCents).toBeUndefined();
    expect(noEstimate.payload.description).toBeUndefined();
  });

  it('lets a store manager add and manage staff only in their own store, within their authority', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(bearer(adminToken)).expect(201)).body;
    const storeA = seed.storeId as string;
    const storeB = (await api().post('/api/admin/stores').set(bearer(adminToken)).send({ code: 'PLAN14B', name: 'Second store' }).expect(201)).body.id as string;
    const manager = await createPerson('store-manager@test.pos', 'Store Manager', [storeA]);
    const cashierRole = await roleId('Cashier');
    const managerRole = await roleId('Store Manager');

    // Issue 9: a role assigned by the organisation shows up on the store staff list without being picked again.
    const adminView = (await api().get(`/api/admin/stores/${storeA}/users`).set(bearer(adminToken)).expect(200)).body.users as { email: string; roles: { name: string }[]; roleEditable: boolean; accountManageable: boolean }[];
    const managerRow = adminView.find((user) => user.email === 'store-manager@test.pos')!;
    expect(managerRow.roles.map((role) => role.name)).toEqual(['Store Manager']);

    // Issue 10: add a cashier who can only work in store A.
    const assignable = (await api().get(`/api/admin/stores/${storeA}/assignable-roles`).set(bearer(manager, storeA)).expect(200)).body.roles as { id: string }[];
    expect(assignable.map((role) => role.id)).toContain(cashierRole);
    expect(assignable.map((role) => role.id)).not.toContain(managerRole);
    const created = (await api().post(`/api/admin/stores/${storeA}/users`).set(bearer(manager, storeA)).send({ firstName: 'New', lastName: 'Cashier', email: 'New.Cashier@Test.pos', password: PASSWORD, roleId: cashierRole }).expect(201)).body;
    expect(created).toMatchObject({ email: 'new.cashier@test.pos', storeId: storeA, role: { name: 'Cashier' } });
    const cashierToken = await login('new.cashier@test.pos');
    const me = (await api().get('/api/auth/me').set(bearer(cashierToken)).expect(200)).body;
    expect(me.stores.map((store: { id: string }) => store.id)).toEqual([storeA]);
    expect(me.roles).toEqual([{ name: 'Cashier', scopeType: 'STORE', storeId: storeA }]);

    // Guards: no roles above the manager, no other stores, no duplicate emails, short passwords.
    await api().post(`/api/admin/stores/${storeA}/users`).set(bearer(manager, storeA)).send({ firstName: 'Peer', email: 'peer@test.pos', password: PASSWORD, roleId: managerRole }).expect(400);
    await api().post(`/api/admin/stores/${storeB}/users`).set(bearer(manager, storeB)).send({ firstName: 'Other', email: 'other@test.pos', password: PASSWORD, roleId: cashierRole }).expect(403);
    await api().post(`/api/admin/stores/${storeA}/users`).set(bearer(manager, storeA)).send({ firstName: 'Dup', email: 'new.cashier@test.pos', password: PASSWORD, roleId: cashierRole }).expect(409);
    await api().post(`/api/admin/stores/${storeA}/users`).set(bearer(manager, storeA)).send({ firstName: 'Short', email: 'short@test.pos', password: 'short', roleId: cashierRole }).expect(400);

    // The manager's staff view says what they may do with each row.
    const managerView = (await api().get(`/api/admin/stores/${storeA}/users`).set(bearer(manager, storeA)).expect(200)).body.users as { id: string; email: string; roleEditable: boolean; accountManageable: boolean }[];
    const self = managerView.find((user) => user.email === 'store-manager@test.pos')!;
    const newCashier = managerView.find((user) => user.email === 'new.cashier@test.pos')!;
    expect(self).toMatchObject({ roleEditable: false, accountManageable: false });
    expect(newCashier).toMatchObject({ roleEditable: true, accountManageable: true });

    // Disable, which signs them out and blocks sign-in; reactivate; reset the password.
    await api().patch(`/api/admin/stores/${storeA}/users/${newCashier.id}`).set(bearer(manager, storeA)).send({ status: 'DISABLED' }).expect(200);
    expect((await api().post('/api/auth/login').send({ email: 'new.cashier@test.pos', password: PASSWORD })).status).not.toBe(200);
    await api().patch(`/api/admin/stores/${storeA}/users/${newCashier.id}`).set(bearer(manager, storeA)).send({ status: 'ACTIVE' }).expect(200);
    await api().patch(`/api/admin/stores/${storeA}/users/${newCashier.id}`).set(bearer(manager, storeA)).send({ password: 'Plan14-Reset-Password-2!' }).expect(200);
    await login('new.cashier@test.pos', 'Plan14-Reset-Password-2!');

    // Cannot change yourself, a peer manager, or someone who also works in another store.
    await api().patch(`/api/admin/stores/${storeA}/users/${self.id}`).set(bearer(manager, storeA)).send({ status: 'DISABLED' }).expect(403);
    await createPerson('peer-manager@test.pos', 'Store Manager', [storeA]);
    const peer = ((await api().get(`/api/admin/stores/${storeA}/users`).set(bearer(manager, storeA)).expect(200)).body.users as { id: string; email: string; roleEditable: boolean }[]).find((user) => user.email === 'peer-manager@test.pos')!;
    expect(peer.roleEditable).toBe(false);
    await api().patch(`/api/admin/stores/${storeA}/users/${peer.id}/role`).set(bearer(manager, storeA)).send({ roleId: cashierRole }).expect(403);
    await api().patch(`/api/admin/stores/${storeA}/users/${peer.id}`).set(bearer(manager, storeA)).send({ status: 'DISABLED' }).expect(403);
    await createPerson('two-stores@test.pos', 'Cashier', [storeA, storeB]);
    const shared = ((await api().get(`/api/admin/stores/${storeA}/users`).set(bearer(manager, storeA)).expect(200)).body.users as { id: string; email: string; roleEditable: boolean; accountManageable: boolean }[]).find((user) => user.email === 'two-stores@test.pos')!;
    expect(shared).toMatchObject({ roleEditable: true, accountManageable: false });
    await api().patch(`/api/admin/stores/${storeA}/users/${shared.id}`).set(bearer(manager, storeA)).send({ status: 'DISABLED' }).expect(403);

    // A cashier cannot use the staff endpoints at all.
    const cashierAgain = await login('new.cashier@test.pos', 'Plan14-Reset-Password-2!');
    await api().post(`/api/admin/stores/${storeA}/users`).set(bearer(cashierAgain, storeA)).send({ firstName: 'X', email: 'x@test.pos', password: PASSWORD, roleId: cashierRole }).expect(403);
  });
});

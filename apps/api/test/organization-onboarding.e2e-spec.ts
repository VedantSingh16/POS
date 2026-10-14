import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { gstinCheckChar } from '@pos/shared/tax-id';
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

  it('completes required setup atomically, creates one first store, and lets the owner skip optional setup', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({
      organizationName: 'First Store Test',
      organizationSlug: slug,
      firstName: 'Ada',
      lastName: 'Owner',
      email: 'owner@first-store-test.example',
      password: 'First-Store-Owner-2026!',
    }).expect(201);
    const token = registration.body.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };
    const organizationId = registration.body.user.organizationId as string;
    const setup = {
      organization: { name: 'First Store Test', countryCode: 'IN', currency: 'INR', businessType: 'RETAIL', timezone: 'Asia/Kolkata', taxProfileStatus: 'NOT_REGISTERED', gstin: '' },
      store: { name: 'Main Shop', address: '12 Market Road', city: 'Pune', region: 'Maharashtra', postalCode: '411001', phone: '', timezone: 'Asia/Kolkata' },
    };

    expect((await api().get('/api/auth/me').set(auth).expect(200)).body.organisation.currency).toBe('INR');
    const first = await api().post('/api/admin/onboarding/required').set(auth).send(setup).expect(201);
    expect(first.body.onboarding).toMatchObject({ version: 2, complete: true, required: false, completedSteps: [0, 1] });
    expect(first.body.organization).toMatchObject({ countryCode: 'IN', currency: 'INR', taxProfileStatus: 'NOT_REGISTERED' });
    expect(first.body.store).toMatchObject({ code: 'STORE-01', name: 'Main Shop', register: { code: 'REG-01', name: 'Front Register' } });

    const repeated = await api().post('/api/admin/onboarding/required').set(auth).send(setup).expect(201);
    expect(repeated.body.store.id).toBe(first.body.store.id);
    expect(await prisma.store.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.register.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.stockLocation.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.taxGroup.count({ where: { organizationId } })).toBe(0);

    const owner = await prisma.user.findFirstOrThrow({ where: { organizationId, email: 'owner@first-store-test.example' } });
    expect(owner.defaultStoreId).toBe(first.body.store.id);
    expect(await prisma.userStore.findFirst({ where: { userId: owner.id, storeId: first.body.store.id, isDefault: true } })).not.toBeNull();
    expect((await api().get('/api/auth/me').set(auth).expect(200)).body.onboardingRequired).toBe(false);

    // A single-owner business can use the store without assigning a Store Manager.
    await api().post('/api/admin/onboarding/finish').set(auth).expect(201);
    const skipped = await api().post('/api/admin/onboarding/skip-optional').set(auth).expect(201);
    expect(skipped.body.onboarding.optionalSkippedAt).toEqual(expect.any(String));
  });

  it('rejects a registered Indian tax profile without a valid GSTIN before creating the store', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({
      organizationName: 'Tax Profile Test', organizationSlug: slug, firstName: 'Ada', lastName: 'Owner',
      email: 'owner@tax-profile-test.example', password: 'Tax-Profile-Owner-2026!',
    }).expect(201);
    const auth = { Authorization: `Bearer ${registration.body.accessToken as string}` };
    await api().post('/api/admin/onboarding/required').set(auth).send({
      organization: { name: 'Tax Profile Test', countryCode: 'IN', currency: 'INR', taxProfileStatus: 'REGISTERED' },
      store: { name: 'Main Shop', address: '12 Market Road', city: 'Pune', timezone: 'Asia/Kolkata' },
    }).expect(400);
    expect(await prisma.store.count({ where: { organizationId: registration.body.user.organizationId } })).toBe(0);
  });

  it('allows setup to finish when tax status is unsure but pauses checkout until it is reviewed', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({
      organizationName: 'Tax Review Test', organizationSlug: slug, firstName: 'Ada', lastName: 'Owner',
      email: 'owner@tax-review-test.example', password: 'Tax-Review-Owner-2026!',
    }).expect(201);
    const auth = { Authorization: `Bearer ${registration.body.accessToken as string}` };
    const setup = await api().post('/api/admin/onboarding/required').set(auth).send({
      organization: { name: 'Tax Review Test', countryCode: 'IN', currency: 'INR', taxProfileStatus: 'UNSURE' },
      store: { name: 'Main Shop', address: '12 Market Road', city: 'Pune', timezone: 'Asia/Kolkata' },
    }).expect(201);
    const storeAuth = { ...auth, 'x-store-id': setup.body.store.id as string };
    await api().post('/api/pos/v1/sessions').set(storeAuth).send({ storeId: setup.body.store.id, registerId: setup.body.store.register.id, openingFloatCents: 0 }).expect(201);
    const blocked = await api().post('/api/pos/v1/sales/quote').set(storeAuth).send({ storeId: setup.body.store.id, lines: [] }).expect(400);
    expect(blocked.body.code).toBe('TAX_PROFILE_REQUIRED');
    expect(blocked.body.message).toContain('Settings → General');

    await api().patch('/api/admin/organization').set(auth).send({ countryCode: 'IN', taxProfileStatus: 'NOT_REGISTERED' }).expect(200);
    await api().post('/api/pos/v1/sales/quote').set(storeAuth).send({ storeId: setup.body.store.id, lines: [] }).expect(201);
  });

  it('requires an explicit product tax group before checkout for a registered tax profile', async () => {
    const registration = await api().post('/api/auth/organizations/register').send({
      organizationName: 'Registered Tax Test', organizationSlug: slug, firstName: 'Ada', lastName: 'Owner',
      email: 'owner@registered-tax-test.example', password: 'Registered-Tax-Owner-2026!',
    }).expect(201);
    const auth = { Authorization: `Bearer ${registration.body.accessToken as string}` };
    const first14 = '27ABCDE1234F1Z';
    const gstin = `${first14}${gstinCheckChar(first14)}`;
    const setup = await api().post('/api/admin/onboarding/required').set(auth).send({
      organization: { name: 'Registered Tax Test', countryCode: 'IN', currency: 'INR', taxProfileStatus: 'REGISTERED', gstin },
      store: { name: 'Main Shop', address: '12 Market Road', city: 'Pune', timezone: 'Asia/Kolkata' },
    }).expect(201);
    const storeAuth = { ...auth, 'x-store-id': setup.body.store.id as string };
    const product = (await api().post('/api/admin/catalog/products').set(auth).send({ name: 'Unassigned Tax Item' }).expect(201)).body;
    const variant = (await api().post(`/api/admin/catalog/products/${product.id as string}/variants`).set(auth).send({ sku: 'TAX-REQUIRED', name: 'Each', amountCents: 10000 }).expect(201)).body.variants[0];
    await api().post('/api/pos/v1/store-products').set(storeAuth).send({ storeId: setup.body.store.id, variantIds: [variant.id] }).expect(201);

    const missing = await api().post('/api/pos/v1/sales/quote').set(storeAuth).send({ storeId: setup.body.store.id, lines: [{ variantId: variant.id, quantity: 1 }] }).expect(400);
    expect(missing.body.code).toBe('TAX_CONFIGURATION_REQUIRED');
    expect(missing.body.message).toContain('/org/catalog/tax');

    const taxGroup = (await api().post('/api/admin/catalog/tax-groups').set(auth).send({ code: 'GST5', name: 'GST 5%', ratePercent: 5 }).expect(201)).body;
    await api().patch(`/api/admin/catalog/variants/${variant.id as string}`).set(auth).send({ taxGroupId: taxGroup.id }).expect(200);
    const ready = await api().post('/api/pos/v1/sales/quote').set(storeAuth).send({ storeId: setup.body.store.id, lines: [{ variantId: variant.id, quantity: 1 }] }).expect(201);
    expect(ready.body.lines[0].taxRateBps).toBe(500);
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

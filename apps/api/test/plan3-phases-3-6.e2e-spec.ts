import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { hashPassword } from '../src/security/password.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };

describe('Plan 3 MVP phases 3–6 (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    token = (await api().post('/api/auth/login').send(ADMIN).expect(200)).body.accessToken;
  });

  afterEach(async () => { await app.close(); });

  it('persists onboarding progress, organisation metadata and catalogue import validation', async () => {
    await api().get('/api/admin/onboarding').set(auth()).expect(200).expect((response) => expect(response.body.onboarding.complete).toBe(false));
    await api().patch('/api/admin/organization').set(auth()).send({ legalName: 'Retail Legal Ltd', tradeName: 'Retail', gstin: '29ABCDE1234F1Z5', timezone: 'Asia/Kolkata' }).expect(200);
    await api().patch('/api/admin/onboarding').set(auth()).send({ currentStep: 1, data: { legalName: 'Retail Legal Ltd' } }).expect(200);
    const invalid = await api().post('/api/admin/catalog/import/preview').set(auth()).send({ rows: [{ sku: 'BAD-1', name: '', price: '-1' }] }).expect(201);
    expect(invalid.body.errors.map((error: { field: string }) => error.field)).toEqual(expect.arrayContaining(['name', 'price']));
    const valid = await api().post('/api/admin/catalog/import/preview').set(auth()).send({ rows: [{ sku: 'IMP-1', name: 'Imported item', productName: 'Imported product', price: '12.50', barcode: '890000001234', ratePercent: 5 }] }).expect(201);
    expect(valid.body.validRows).toBe(1);
    await api().post('/api/admin/catalog/import/commit').set(auth()).send({ rows: [{ sku: 'IMP-1', name: 'Imported item', productName: 'Imported product', price: '12.50', barcode: '890000001234', ratePercent: 5 }] }).expect(201);
    const search = await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201);
    const products = (await api().get('/api/admin/catalog/products').set(auth()).expect(200)).body.products;
    expect(products.some((product: { variants: { sku: string }[] }) => product.variants.some((variant) => variant.sku === 'IMP-1'))).toBe(true);
    expect(search.body.variantId).toEqual(expect.any(String));
  });

  it('enforces the store entitlement under concurrent onboarding requests', async () => {
    const overview = await api().get('/api/admin/overview').set(auth()).expect(200);
    const remaining = Math.max(0, Number(overview.body.entitlement.remainingStores));
    const attempts = remaining + 2;
    const responses = await Promise.all(Array.from({ length: attempts }, (_, index) => api().post('/api/admin/stores').set(auth()).send({
      code: `CONCURRENT-${index}-${Date.now()}`,
      name: `Concurrent store ${index}`,
    })));
    expect(responses.every((response) => response.status === 201 || response.status === 409)).toBe(true);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(remaining);
    expect((await api().get('/api/admin/overview').set(auth()).expect(200)).body.entitlement.currentStores).toBe(Number(overview.body.entitlement.currentStores) + remaining);
  });

  it('validates and commits a 500-row catalogue import, then searches the imported variants', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      sku: `BULK-${String(index).padStart(4, '0')}`,
      name: `Bulk item ${index}`,
      productName: `Bulk product ${index}`,
      price: '12.50',
      barcode: `890000${String(index).padStart(6, '0')}`,
      ratePercent: 5,
    }));
    const preview = await api().post('/api/admin/catalog/import/preview').set(auth()).send({ rows }).expect(201);
    expect(preview.body).toMatchObject({ rowCount: 500, validRows: 500, errors: [] });
    const committed = await api().post('/api/admin/catalog/import/commit').set(auth()).send({ rows }).expect(201);
    expect(committed.body).toEqual({ imported: 500 });
    const started = performance.now();
    const search = await api().get('/api/pos/v1/catalog/search?q=BULK-0499').set(auth()).expect(200);
    expect(performance.now() - started).toBeLessThan(200);
    expect(search.body.products).toEqual(expect.arrayContaining([expect.objectContaining({ sku: 'BULK-0499' })]));
  });

  it('returns catalogue filter metadata and selected-store stock for the organisation product list', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    const category = (await api().post('/api/admin/catalog/categories').set(auth()).send({ name: 'Filtered category' }).expect(201)).body;
    const taxGroup = (await api().post('/api/admin/catalog/tax-groups').set(auth()).send({ code: 'FILTER-5', name: 'Filter GST 5', ratePercent: 5 }).expect(201)).body;
    const product = (await api().post('/api/admin/catalog/products').set(auth()).send({ name: 'Filterable shirt', brand: 'Filter Brand', categoryId: category.id }).expect(201)).body;
    const created = (await api().post(`/api/admin/catalog/products/${product.id}/variants`).set(auth()).send({ sku: 'FILTER-SHIRT-S', name: 'Size: S', barcode: '890000009001', amountCents: 12500, taxGroupId: taxGroup.id }).expect(201)).body;
    const variantId = created.variants.find((variant: { sku: string }) => variant.sku === 'FILTER-SHIRT-S').id;
    await api().post('/api/pos/v1/inventory/opening-stock/commit').set(auth()).send({ storeId: seed.storeId, rows: [{ sku: 'FILTER-SHIRT-S', quantity: 7 }] }).expect(201);

    const listed = await api().get('/api/admin/catalog/products').set(auth()).expect(200);
    const row = listed.body.products.find((item: { id: string }) => item.id === product.id);
    expect(row.category).toEqual({ id: category.id, name: category.name });
    expect(row.brand).toBe('Filter Brand');
    expect(row.variants[0]).toMatchObject({ id: variantId, status: 'ACTIVE', taxGroupId: taxGroup.id, barcodes: ['890000009001'] });

    const editedProduct = await api().patch(`/api/admin/catalog/products/${product.id}`).set(auth()).send({ name: 'Filterable shirt updated', brand: 'Updated Filter Brand', description: 'Edited product', categoryId: category.id }).expect(200);
    expect(editedProduct.body).toMatchObject({ name: 'Filterable shirt updated', brand: 'Updated Filter Brand', description: 'Edited product', category: { id: category.id, name: category.name } });
    const editedVariant = await api().patch(`/api/admin/catalog/variants/${variantId}`).set(auth()).send({ sku: 'FILTER-SHIRT-S-EDIT', name: 'Size: Small', status: 'SEASONAL', costCents: 7000, amountCents: 13000, taxGroupId: taxGroup.id, barcodes: ['890000009002', '890000009003'], includesTax: false }).expect(200);
    expect(editedVariant.body.variants[0]).toMatchObject({ sku: 'FILTER-SHIRT-S-EDIT', name: 'Size: Small', status: 'SEASONAL', costCents: 7000, taxGroupId: taxGroup.id, barcodes: ['890000009002', '890000009003'] });
    expect(editedVariant.body.variants[0].prices[0]).toMatchObject({ amountCents: 13000, includesTax: false });
    const inventory = await api().get(`/api/pos/v1/inventory?storeId=${seed.storeId}`).set(auth()).expect(200);
    expect(inventory.body.balances).toEqual(expect.arrayContaining([expect.objectContaining({ variantId, quantity: 7 })]));
  });

  it('searches name, SKU, barcode and brand under 200 ms with 10,000 variants', async () => {
    const record = await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email }, select: { organizationId: true } });
    const organizationId = record.organizationId;
    const variantCount = 10_000;
    const products = Array.from({ length: variantCount }, (_, index) => ({
      organizationId,
      name: `Perf Product ${String(index).padStart(5, '0')}`,
      brand: `Perf Brand ${String(index).padStart(5, '0')}`,
    }));
    await prisma.product.createMany({ data: products });
    const productRows = await prisma.product.findMany({
      where: { organizationId, name: { startsWith: 'Perf Product ' } },
      select: { id: true, name: true },
    });
    expect(productRows).toHaveLength(variantCount);
    const variants = productRows.map((product) => {
      const index = Number(product.name.slice('Perf Product '.length));
      return { organizationId, productId: product.id, sku: `PERF-${String(index).padStart(5, '0')}`, name: `Perf Variant ${String(index).padStart(5, '0')}` };
    });
    await prisma.productVariant.createMany({ data: variants });
    const variantRows = await prisma.productVariant.findMany({
      where: { organizationId, sku: { startsWith: 'PERF-' } },
      select: { id: true, sku: true },
    });
    await prisma.barcode.createMany({ data: variantRows.map((variant) => ({ organizationId, variantId: variant.id, code: `890099${variant.sku.slice(5)}` })) });

    const queries = [
      ['name', 'Perf Product 09999'],
      ['SKU', 'PERF-09999'],
      ['barcode', '89009909999'],
      ['brand', 'Perf Brand 09999'],
    ] as const;
    const timings: Record<string, number> = {};
    for (const [field, query] of queries) {
      const samples: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const started = performance.now();
        const result = await api().get(`/api/pos/v1/catalog/search?q=${encodeURIComponent(query)}`).set(auth()).expect(200);
        samples.push(performance.now() - started);
        expect(result.body.products).toEqual(expect.arrayContaining([expect.objectContaining({ sku: 'PERF-09999' })]));
      }
      samples.sort((a, b) => a - b);
      timings[field] = Math.round(samples[1] * 100) / 100;
      expect(timings[field]).toBeLessThan(200);
    }
    console.log(`10k variant median search latency (ms): ${JSON.stringify(timings)}`);
  });

  it('supports cash rounding, tender metadata, denomination close and permission effects', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'ALLOW' }).expect(200);
    await api().post('/api/pos/v1/inventory/opening-stock/commit').set(auth()).send({ storeId: seed.storeId, rows: [{ sku: 'MUG-BLUE', quantity: 1 }] }).expect(201);
    await api().patch('/api/admin/settings').set(auth()).send({ cashRounding: 500 }).expect(200);
    const session = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, openingFloatCents: 0 }).expect(201)).body;
    const sale = (await api().post('/api/pos/v1/sales').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, sessionId: session.id, lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CASH', tenderedCents: 50000, amountCents: 50000 }] }).expect(201)).body.sale;
    expect(sale.roundingCents).toBe(100);
    expect(sale.payments[0]).toMatchObject({ amountCents: 50000, tenderedCents: 50000, changeCents: 0 });
    const closed = await api().post(`/api/pos/v1/sessions/${session.id}/close`).set(auth()).send({ denominations: [{ denominationCents: 1000, count: 50 }] }).expect(201);
    expect(closed.body.countedCashCents).toBe(50000);
    expect(closed.body.countedByDenomination[0]).toMatchObject({ denominationCents: 1000, count: 50 });
    const role = (await api().post('/api/admin/roles').set(auth()).send({ name: 'Approval role', permissions: ['sale.create', 'sale.discount'], permissionEffects: { 'sale.discount': 'REQUIRE_APPROVAL' } }).expect(201)).body;
    expect(role.permissionEffects['sale.discount']).toBe('REQUIRE_APPROVAL');
  });

  it('reconciles opening stock, sale, damaged return and projection rebuild', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    await api().post('/api/pos/v1/inventory/opening-stock/commit').set(auth()).send({ storeId: seed.storeId, rows: [{ sku: 'MUG-BLUE', quantity: 5 }] }).expect(201);
    const session = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId }).expect(201)).body;
    const sale = (await api().post('/api/pos/v1/sales').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, sessionId: session.id, lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'UPI', amountCents: 49900 }] }).expect(201)).body.sale;
    await api().post('/api/pos/v1/returns').set(auth()).send({ saleId: sale.id, sessionId: session.id, lines: [{ saleLineId: sale.lines[0].id, quantity: 1, restockStatus: 'DAMAGED' }], tenderType: 'UPI', reason: 'Damaged' }).expect(201);
    const before = (await api().get(`/api/pos/v1/inventory?storeId=${seed.storeId}`).set(auth()).expect(200)).body.balances;
    expect(before.find((row: { status: string }) => row.status === 'SELLABLE').quantity).toBe(4);
    expect(before.find((row: { status: string }) => row.status === 'DAMAGED').quantity).toBe(1);
    await api().post('/api/pos/v1/inventory/rebuild').set(auth()).expect(201);
    const after = (await api().get(`/api/pos/v1/inventory?storeId=${seed.storeId}`).set(auth()).expect(200)).body.balances;
    expect(after.map((row: { status: string; quantity: number }) => [row.status, row.quantity])).toEqual(expect.arrayContaining([['SELLABLE', 4], ['DAMAGED', 1]]));
  });

  it('blocks negative stock when the store policy is explicitly BLOCK', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'BLOCK' }).expect(200);
    const session = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId }).expect(201)).body;
    await api().post('/api/pos/v1/sales').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, sessionId: session.id, lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CARD', amountCents: 49900 }] }).expect(400);
  });

  it('accepts a different authorized manager PIN for a controlled discount and audits the approval', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'ALLOW' }).expect(200);
    await api().post('/api/pos/v1/inventory/opening-stock/commit').set(auth()).send({ storeId: seed.storeId, rows: [{ sku: 'MUG-BLUE', quantity: 1 }] }).expect(201);
    const role = (await api().post('/api/admin/roles').set(auth()).send({ name: `Cashier discount ${Date.now()}`, permissions: ['sale.create', 'sale.discount', 'register.open'] }).expect(201)).body;
    const suffix = Date.now();
    const cashierEmail = `discount-cashier-${suffix}@test.pos`;
    const managerEmail = `discount-manager-${suffix}@test.pos`;
    await api().post('/api/admin/users').set(auth()).send({ email: cashierEmail, password: 'Cashier-Password-2026!', firstName: 'Discount', lastName: 'Cashier', storeIds: [seed.storeId], roleAssignments: [{ roleId: role.id, scopeType: 'STORE', scopeId: seed.storeId }] }).expect(201);
    const roles = (await api().get('/api/admin/roles').set(auth()).expect(200)).body.roles as { id: string; name: string }[];
    const adminRole = roles.find((value) => value.name === 'Organisation Administrator');
    await api().post('/api/admin/users').set(auth()).send({ email: managerEmail, password: 'Manager-Password-2026!', firstName: 'Discount', lastName: 'Manager', storeIds: [], roleAssignments: [{ roleId: adminRole!.id, scopeType: 'ORGANIZATION', scopeId: null }] }).expect(201);
    const adminRecord = await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } });
    const manager = await prisma.user.findUniqueOrThrow({ where: { organizationId_email: { organizationId: adminRecord.organizationId, email: managerEmail } } });
    await prisma.user.update({ where: { id: manager.id }, data: { pinHash: hashPassword('2468') } });
    const cashierToken = (await api().post('/api/auth/login').send({ email: cashierEmail, password: 'Cashier-Password-2026!' }).expect(200)).body.accessToken as string;
    const cashierAuth = () => ({ Authorization: `Bearer ${cashierToken}` });
    const session = (await api().post('/api/pos/v1/sessions').set(cashierAuth()).send({ storeId: seed.storeId, registerId: seed.registerId }).expect(201)).body;
    const sale = await api().post('/api/pos/v1/sales').set(cashierAuth()).send({ storeId: seed.storeId, registerId: seed.registerId, sessionId: session.id, discountCents: 5000, discountReason: 'Manager approved promotion', managerPin: '2468', lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CARD', amountCents: 44650 }] }).expect(201);
    expect(await prisma.approval.findFirst({ where: { referenceId: sale.body.sale.id, status: 'APPROVED', approvedById: manager.id } })).not.toBeNull();
  });

  it('keeps invoice numbers sequential across 20 concurrent sales within the LAN budget', async () => {
    const seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'BLOCK' }).expect(200);
    await api().post('/api/pos/v1/inventory/opening-stock/commit').set(auth()).send({ storeId: seed.storeId, rows: [{ sku: 'MUG-BLUE', quantity: 20 }] }).expect(201);
    const session = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId }).expect(201)).body;
    const started = performance.now();
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => api().post('/api/pos/v1/sales').set(auth()).send({
      storeId: seed.storeId,
      registerId: seed.registerId,
      sessionId: session.id,
      clientSaleId: `concurrent-sale-${Date.now()}-${index}`,
      lines: [{ variantId: seed.variantId, quantity: 1 }],
      payments: [{ tenderType: 'CARD', amountCents: 49900 }],
    }).expect(201)));
    const elapsed = performance.now() - started;
    const receipts = responses.map((response) => response.body.sale.receiptNumber as string);
    expect(new Set(receipts).size).toBe(20);
    const sequence = receipts.map((receipt) => Number(receipt.split('-').at(-1))).sort((a, b) => a - b);
    expect(sequence).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(elapsed).toBeLessThan(1000);
  });
});

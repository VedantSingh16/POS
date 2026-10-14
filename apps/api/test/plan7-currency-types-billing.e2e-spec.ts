import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { gstinCheckChar } from '@pos/shared/tax-id';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

const ADMIN = { email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' };
const PIN = '2468';

function gstin(state: string, pan: string) {
  const first14 = `${state}${pan}1Z`;
  return first14 + gstinCheckChar(first14);
}

describe('Plan 7 currency, product types, store billing (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let seed: { storeId: string; registerId: string; variantId: string };
  let sessionId: string;
  let managerToken: string;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const prisma = () => app.get(PrismaService);
  let counter = 0;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    token = (await api().post('/api/auth/login').send(ADMIN).expect(200)).body.accessToken;
    seed = (await api().post('/api/pos/v1/demo/seed').set(auth()).expect(201)).body;
    await api().patch('/api/admin/settings').set(auth()).send({ inventoryPolicy: 'ALLOW' }).expect(200);
    sessionId = (await api().post('/api/pos/v1/sessions').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, openingFloatCents: 0 }).expect(201)).body.id;
  });
  afterEach(async () => { await app.close(); });

  const product = async (amountCents: number, extra: Record<string, unknown> = {}) => {
    counter += 1;
    const sku = `P6-${counter}-${Date.now() % 100000}`;
    const res = await api().post(`/api/pos/v1/stores/${seed.storeId}/products`).set(auth()).send({ name: `Item ${sku}`, sku, amountCents, openingQuantity: 100, ...extra }).expect(201);
    return { variantId: res.body.variantId as string, sku };
  };
  const body = (extra: Record<string, unknown>) => ({ storeId: seed.storeId, registerId: seed.registerId, sessionId, ...extra });
  const quote = (extra: Record<string, unknown>) => api().post('/api/pos/v1/sales/quote').set(auth()).send(body(extra));
  const sell = (extra: Record<string, unknown>) => api().post('/api/pos/v1/sales').set(auth()).send(body(extra));
  const lineOf = (variantId: string, quantity = 1, more: Record<string, unknown> = {}) => ({ variantId, quantity, ...more });
  const manager = async () => {
    const roles = (await api().get('/api/admin/roles').set(auth()).expect(200)).body.roles as { id: string; name: string }[];
    const role = roles.find((r) => r.name === 'Store Manager')!;
    const email = `mgr-${Date.now()}@test.pos`;
    await api().post('/api/admin/users').set(auth()).send({ email, password: 'Manager-Password-2026!', firstName: 'M', lastName: 'G', storeIds: [seed.storeId], roleAssignments: [{ roleId: role.id, scopeType: 'ORGANIZATION', scopeId: null }] }).expect(201);
    managerToken = (await api().post('/api/auth/login').send({ email, password: 'Manager-Password-2026!' }).expect(200)).body.accessToken;
    await api().post('/api/auth/pin').set({ Authorization: `Bearer ${managerToken}` }).send({ pin: PIN }).expect(204);
  };

  const pdfText = async (saleId: string) => ((await api().get(`/api/pos/v1/sales/${saleId}/invoice.pdf`).set(auth()).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200)).body as Buffer).toString('latin1');
  const categoryOf = async (name: string) => (await api().post('/api/admin/catalog/categories').set(auth()).send({ name }).expect(201)).body.id as string;
  const brandOf = async (name: string) => (await api().post('/api/admin/catalog/brands').set(auth()).send({ name }).expect(201)).body.id as string;

  // ───────── currency ─────────
  it('defaults to the Omani rial with three decimals on the screen data and the invoice', async () => {
    expect((await api().get('/api/admin/settings').set(auth()).expect(200)).body.currency).toBe('OMR');
    expect((await api().get('/api/auth/me').set(auth()).expect(200)).body.organisation.currency).toBe('OMR');
    // 49,900 baisa = OMR 49.900
    const sale = (await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CASH', amountCents: 49900 }] }).expect(201)).body.sale;
    const text = await pdfText(sale.id);
    expect(text).toContain('OMR 49.900');
    expect(text).toContain('Forty Nine Omani Rials and Nine Hundred Baisa Only');
    // Oman has one VAT, not CGST/SGST/IGST, and no place of supply.
    expect(text).toContain('VAT');
    expect(text).not.toContain('CGST');
    expect(text).not.toContain('IGST');
    expect(text).not.toContain('Place of supply');
  });

  it('keeps Indian GST wording and rupee grouping when the organisation uses rupees', async () => {
    await api().patch('/api/admin/settings').set(auth()).send({ currency: 'INR' }).expect(200);
    const sale = (await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CASH', amountCents: 49900 }] }).expect(201)).body.sale;
    const text = await pdfText(sale.id);
    expect(text).toContain('Rs. 499.00');
    expect(text).toContain('CGST');
    expect(text).toContain('Four Hundred Ninety Nine Rupees Only');
  });

  it('refuses unknown currencies and locks the currency once a sale exists', async () => {
    expect((await api().get('/api/admin/settings').set(auth()).expect(200)).body.currencyLocked).toBe(false);
    expect((await api().patch('/api/admin/settings').set(auth()).send({ currency: 'XYZ' })).status).toBe(400);
    await api().patch('/api/admin/settings').set(auth()).send({ currency: 'AED' }).expect(200);
    expect((await api().get('/api/admin/settings').set(auth()).expect(200)).body.currency).toBe('AED');
    await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CASH', amountCents: 49900 }] }).expect(201);
    expect((await api().get('/api/admin/settings').set(auth()).expect(200)).body.currencyLocked).toBe(true);
    const locked = await api().patch('/api/admin/settings').set(auth()).send({ currency: 'USD' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('CURRENCY_LOCKED');
    await api().patch('/api/admin/settings').set(auth()).send({ currency: 'AED', receiptFooter: 'Same currency is fine' }).expect(200);
  });

  it('reads a fixed-amount offer in whole rials and takes 1,000 baisa off', async () => {
    await api().post('/api/pos/v1/promotions').set(auth()).send({ code: 'ONEOMR', type: 'AMOUNT', value: 1 }).expect(201);
    const q = (await quote({ lines: [{ variantId: seed.variantId, quantity: 1 }], couponCode: 'ONEOMR' }).expect(201)).body;
    expect(q.promotionDiscountCents).toBe(1000);
    // The offer comes off the price before tax: 47,524 - 1,000 = 46,524, plus 5% VAT (2,326).
    expect(q.totalCents).toBe(48850);
  });

  // ───────── product types ─────────
  it('applies a product type: allowed categories and brands, required fields, extra fields, barcode', async () => {
    const shoes = await categoryOf('Footwear');
    const food = await categoryOf('Snacks');
    const nike = await brandOf('Stride');
    const type = (await api().post('/api/admin/catalog/product-types').set(auth()).send({
      name: 'Footwear', description: 'Shoes and sandals',
      config: { categoryIds: [shoes], brandIds: [nike], requireBrand: true, requireBarcode: true, requireTaxGroup: false, attributes: [
        { label: 'Size', kind: 'SELECT', options: ['S', 'M', 'L'], required: true }, { label: 'Weight (g)', kind: 'NUMBER' }, { label: 'Waterproof', kind: 'YESNO' }] },
    }).expect(201)).body;
    expect(type.config.attributes.map((a: { key: string }) => a.key)).toEqual(['size', 'weight_g', 'waterproof']);
    expect((await api().post('/api/admin/catalog/product-types').set(auth()).send({ name: 'Footwear' })).status).toBe(409);

    const make = (extra: Record<string, unknown>) => api().post('/api/admin/catalog/products').set(auth()).send({ name: 'Runner', productTypeId: type.id, ...extra });
    expect((await make({ categoryId: food, brandId: nike, attributes: { size: 'M' } })).status).toBe(400); // category not allowed
    expect((await make({ categoryId: shoes, attributes: { size: 'M' } })).status).toBe(400); // brand required
    expect((await make({ categoryId: shoes, brandId: nike, attributes: {} })).status).toBe(400); // size required
    expect((await make({ categoryId: shoes, brandId: nike, attributes: { size: 'XXL' } })).status).toBe(400); // not an option
    expect((await make({ categoryId: shoes, brandId: nike, attributes: { size: 'M', colour: 'red' } })).status).toBe(400); // unknown field
    expect((await make({ categoryId: shoes, brandId: nike, attributes: { size: 'M', weight_g: 'heavy' } })).status).toBe(400); // not a number
    const product = (await make({ categoryId: shoes, brandId: nike, attributes: { size: 'M', weight_g: '450', waterproof: true } }).expect(201)).body;
    expect(product.productType.name).toBe('Footwear');
    expect(product.attributes).toEqual({ size: 'M', weight_g: 450, waterproof: true });

    // The type also asks for a barcode on every variant.
    const noBarcode = await api().post(`/api/admin/catalog/products/${product.id}/variants`).set(auth()).send({ sku: 'RUN-1', name: 'Size 42', amountCents: 25000 });
    expect(noBarcode.status).toBe(400);
    await api().post(`/api/admin/catalog/products/${product.id}/variants`).set(auth()).send({ sku: 'RUN-1', name: 'Size 42', amountCents: 25000, barcode: '6291000000011' }).expect(201);

    // Products without a type are unaffected.
    await api().post('/api/admin/catalog/products').set(auth()).send({ name: 'Plain', categoryId: food }).expect(201);
    // Extra fields without a type are refused rather than silently dropped.
    expect((await api().post('/api/admin/catalog/products').set(auth()).send({ name: 'Plain 2', attributes: { size: 'M' } })).status).toBe(400);
  });

  it('changes type and clears the old extra fields; a switched-off type cannot be assigned', async () => {
    const typeA = (await api().post('/api/admin/catalog/product-types').set(auth()).send({ name: 'Type A', config: { attributes: [{ label: 'Colour', kind: 'TEXT' }] } }).expect(201)).body;
    const typeB = (await api().post('/api/admin/catalog/product-types').set(auth()).send({ name: 'Type B', config: { attributes: [{ label: 'Expiry', kind: 'DATE', required: true }] } }).expect(201)).body;
    const product = (await api().post('/api/admin/catalog/products').set(auth()).send({ name: 'Thing', productTypeId: typeA.id, attributes: { colour: 'red' } }).expect(201)).body;
    // Type B needs an expiry date, so moving over without one is refused...
    expect((await api().patch(`/api/admin/catalog/products/${product.id}`).set(auth()).send({ productTypeId: typeB.id })).status).toBe(400);
    // ...and with one, the old fields are gone.
    const moved = (await api().patch(`/api/admin/catalog/products/${product.id}`).set(auth()).send({ productTypeId: typeB.id, attributes: { expiry: '2027-01-31' } }).expect(200)).body;
    expect(moved.attributes).toEqual({ expiry: '2027-01-31' });
    expect((await api().patch(`/api/admin/catalog/products/${product.id}`).set(auth()).send({ productTypeId: typeB.id, attributes: { expiry: 'tomorrow' } })).status).toBe(400);
    // Removing the type clears the fields.
    const cleared = (await api().patch(`/api/admin/catalog/products/${product.id}`).set(auth()).send({ productTypeId: null }).expect(200)).body;
    expect(cleared.productType).toBeNull();
    expect(cleared.attributes).toEqual({});
    await api().patch(`/api/admin/catalog/product-types/${typeA.id}`).set(auth()).send({ status: 'DISABLED' }).expect(200);
    expect((await api().post('/api/admin/catalog/products').set(auth()).send({ name: 'Late', productTypeId: typeA.id })).status).toBe(400);
    const list = (await api().get('/api/admin/catalog/product-types').set(auth()).expect(200)).body.types;
    expect(list.find((t: { id: string }) => t.id === typeB.id).productCount).toBe(0);
  });

  it('lets only the organisation (not a store manager) configure product types', async () => {
    await manager();
    const asManager = { Authorization: `Bearer ${managerToken}` };
    expect((await api().post('/api/admin/catalog/product-types').set(asManager).send({ name: 'Sneaky' })).status).toBe(403);
    expect((await api().get('/api/admin/catalog/product-types').set(asManager)).status).toBe(200);
  });

  // ───────── store billing ─────────
  it('lets a store override billing settings and fall back to the organisation defaults', async () => {
    await api().patch('/api/admin/settings').set(auth()).send({ receiptFooter: 'Organisation footer' }).expect(200);
    const url = `/api/admin/stores/${seed.storeId}/settings`;
    const before = (await api().get(url).set(auth()).expect(200)).body;
    expect(before.billing).toEqual({});
    expect(before.organisationBilling.receiptFooter).toBe('Organisation footer');
    expect(before.currency).toBe('OMR');
    expect(before.currencyLocked).toBe(false);

    const sale1 = (await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CARD', amountCents: 49900 }] }).expect(201)).body.sale;
    expect((await api().get(url).set(auth()).expect(200)).body.currencyLocked).toBe(true);
    expect(await pdfText(sale1.id)).toContain('Organisation footer');

    const after = (await api().patch(url).set(auth()).send({ billing: { receiptFooter: 'Pratapgarh branch thanks you', enabledTenders: ['CASH', 'UPI'], holdTtlHours: 2 } }).expect(200)).body;
    expect(after.billing.receiptFooter).toBe('Pratapgarh branch thanks you');
    expect(after.organisationBilling.receiptFooter).toBe('Organisation footer');

    // This store now takes only cash and UPI, and prints its own footer.
    // The till is told which tenders to show.
    expect((await quote({ lines: [{ variantId: seed.variantId, quantity: 1 }] }).expect(201)).body.enabledTenders).toEqual(['CASH', 'UPI']);
    expect((await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CARD', amountCents: 49900 }] })).status).toBe(400);
    const sale2 = (await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'UPI', amountCents: 49900 }] }).expect(201)).body.sale;
    const text2 = await pdfText(sale2.id);
    expect(text2).toContain('Pratapgarh branch thanks you');
    expect(text2).not.toContain('Organisation footer');
    // An invoice printed earlier keeps the footer it was issued with.
    expect(await pdfText(sale1.id)).toContain('Organisation footer');

    // Holds follow the store's own lifetime.
    const hold = (await api().post('/api/pos/v1/holds').set(auth()).send({ storeId: seed.storeId, registerId: seed.registerId, clientHoldId: 'h-billing', payload: { lines: [] } }).expect(201)).body;
    const hours = (new Date(hold.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.9);
    expect(hours).toBeLessThan(2.1);

    // Clearing a setting (null) goes back to the organisation's.
    await api().patch(url).set(auth()).send({ billing: { enabledTenders: null, receiptFooter: null } }).expect(200);
    await sell({ lines: [{ variantId: seed.variantId, quantity: 1 }], payments: [{ tenderType: 'CARD', amountCents: 49900 }] }).expect(201);
    expect((await api().get(url).set(auth()).expect(200)).body.billing).toEqual({ holdTtlHours: 2 });
  });

  it('rejects wrong billing values for a store and for the organisation', async () => {
    const url = `/api/admin/stores/${seed.storeId}/settings`;
    for (const billing of [{ enabledTenders: [] }, { enabledTenders: ['BITCOIN'] }, { holdTtlHours: 0 }, { holdTtlHours: 9999 }, { cashRounding: -5 }, { cashRounding: 2.5 }, { pointValueCents: 0 }, { requireDiscountReasonCode: 'yes' }, { receiptFooter: 'x'.repeat(301) }]) {
      expect((await api().patch(url).set(auth()).send({ billing })).status).toBe(400);
    }
    expect((await api().patch('/api/admin/settings').set(auth()).send({ holdTtlHours: 0 })).status).toBe(400);
    expect((await api().patch(url).set(auth()).send({ billing: 'nope' })).status).toBe(400);
  });
});

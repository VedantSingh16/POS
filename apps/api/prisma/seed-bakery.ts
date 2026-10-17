import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedFoundation } from '../src/bootstrap/foundation.js';
import { hashPassword } from '../src/security/password.js';

loadEnv({ path: '../../.env' });

const connectionString = process.env.DATABASE_URL;
const SEED_CONFIRM = 'GOLDEN_CRUST_BAKERY';
if (!connectionString) throw new Error('DATABASE_URL must be set');
if (process.env.SEED_CONFIRM !== SEED_CONFIRM) {
  throw new Error(`Refusing to seed without SEED_CONFIRM=${SEED_CONFIRM}. This guard is required for production runs.`);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'GoldenCrustAdmin!2026';
const STORE_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? 'GoldenCrustStaff!2026';

const organizationConfig = {
  organizationName: 'Golden Crust Bakery',
  organizationSlug: 'golden-crust-bakery',
  maxStores: 5,
  adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'owner@goldencrust.example',
  adminPassword: PASSWORD,
};

const operatingHours = {
  monday: { open: '06:30', close: '22:00' },
  tuesday: { open: '06:30', close: '22:00' },
  wednesday: { open: '06:30', close: '22:00' },
  thursday: { open: '06:30', close: '22:00' },
  friday: { open: '06:30', close: '23:00' },
  saturday: { open: '07:00', close: '23:00' },
  sunday: { open: '07:00', close: '21:00' },
};

const productFieldSet = {
  version: 1,
  allowStoreFields: false,
  coreFields: ['name', 'description', 'category', 'sku', 'barcode', 'price', 'cost', 'uom', 'status'],
  fields: [
    { key: 'allergens', label: 'Allergens', type: 'TEXT', required: false, active: true, order: 0, helpText: 'Ingredient allergens for customer-facing information', options: [], storeEditable: false, showOnReceipt: false, showInList: true, level: 'PRODUCT' },
    { key: 'expiry_hours', label: 'Shelf life (hours)', type: 'NUMBER', required: false, active: true, order: 1, helpText: 'Typical shelf life for freshly prepared items', options: [], storeEditable: false, showOnReceipt: false, showInList: false, level: 'PRODUCT', min: 1, max: 720 },
    { key: 'batch_number', label: 'Batch number', type: 'TEXT', required: false, active: true, order: 2, helpText: 'Production batch reference', options: [], storeEditable: false, showOnReceipt: false, showInList: false, level: 'VARIANT' },
  ],
};

const storesConfig = [
  { code: 'GCB-KHUWAIR', name: 'Golden Crust Al Khuwair', city: 'Muscat', region: 'Muscat', address: 'Al Khuwair, Way 3015', phone: '+968 2456 1101' },
  { code: 'GCB-QURUM', name: 'Golden Crust Qurum', city: 'Muscat', region: 'Muscat', address: 'Qurum, Al Nahda Street', phone: '+968 2456 1102' },
  { code: 'GCB-SEEB', name: 'Golden Crust Seeb', city: 'Seeb', region: 'Muscat', address: 'Al Hail North, Al Bahja Street', phone: '+968 2456 1103' },
  { code: 'GCB-BAWSHAR', name: 'Golden Crust Bawshar', city: 'Muscat', region: 'Muscat', address: 'Bawshar, 18 November Street', phone: '+968 2456 1104' },
  { code: 'GCB-HAIL', name: 'Golden Crust Al Hail', city: 'Seeb', region: 'Muscat', address: 'Al Hail South, Al Mawaleh Road', phone: '+968 2456 1105' },
];

const products = [
  ['Sourdough Loaf', 'Breads', 1.9, 1.05], ['Multigrain Loaf', 'Breads', 1.8, 0.95], ['Wholemeal Tin Loaf', 'Breads', 1.6, 0.82],
  ['Brioche Loaf', 'Breads', 2.3, 1.2], ['French Baguette', 'Breads', 0.8, 0.35], ['Garlic Bread', 'Breads', 1.3, 0.6],
  ['Butter Croissant', 'Viennoiserie', 0.75, 0.28], ['Chocolate Croissant', 'Viennoiserie', 0.9, 0.34], ['Pain au Chocolat', 'Viennoiserie', 0.95, 0.36],
  ['Cinnamon Roll', 'Viennoiserie', 1.15, 0.42], ['Almond Danish', 'Viennoiserie', 1.25, 0.5], ['Cardamom Bun', 'Viennoiserie', 1.1, 0.4],
  ['Date Maamoul', 'Cookies', 2.4, 1.2], ['Pistachio Cookies', 'Cookies', 2.6, 1.3], ['Chocolate Chip Cookie', 'Cookies', 0.65, 0.2],
  ['Oatmeal Raisin Cookie', 'Cookies', 0.65, 0.2], ['Baklava Box', 'Desserts', 4.5, 2.4], ['Pistachio Tart', 'Desserts', 3.2, 1.7],
  ['Chocolate Cake Slice', 'Cakes', 2.4, 1.15], ['Vanilla Cake Slice', 'Cakes', 2.2, 1.05], ['Red Velvet Cake Slice', 'Cakes', 2.6, 1.25],
  ['Carrot Cake Slice', 'Cakes', 2.3, 1.1], ['Cheesecake Slice', 'Cakes', 2.8, 1.35], ['Chocolate Cupcake', 'Cakes', 1.1, 0.45],
  ['Vanilla Cupcake', 'Cakes', 1.0, 0.4], ['Chicken Puff', 'Savoury', 1.4, 0.6], ['Spinach Fatayer', 'Savoury', 1.2, 0.5],
  ['Cheese Manakish', 'Savoury', 1.5, 0.65], ['Zaatar Manakish', 'Savoury', 1.3, 0.55], ['Turkey Cheese Sandwich', 'Savoury', 2.6, 1.3],
  ['Iced Latte', 'Beverages', 1.8, 0.65], ['Arabic Coffee', 'Beverages', 1.2, 0.35], ['Fresh Lemon Mint', 'Beverages', 1.5, 0.45],
  ['Mineral Water', 'Beverages', 0.25, 0.1], ['Breakfast Box', 'Bundles', 4.9, 2.5],
] as const;

type AnyPrisma = PrismaClient;
type StoreRecord = Awaited<ReturnType<AnyPrisma['store']['upsert']>>;
type VariantRecord = Awaited<ReturnType<AnyPrisma['productVariant']['upsert']>>;

const json = (value: unknown) => value as any;

async function ensureUser(organizationId: string, email: string, firstName: string, lastName: string, preferredLocale = 'en') {
  const existing = await prisma.user.findUnique({ where: { organizationId_email: { organizationId, email } } });
  return existing
    ? prisma.user.update({ where: { id: existing.id }, data: { firstName, lastName, preferredLocale, status: 'ACTIVE', passwordHash: hashPassword(email === organizationConfig.adminEmail ? PASSWORD : STORE_PASSWORD) } })
    : prisma.user.create({ data: { organizationId, email, firstName, lastName, preferredLocale, status: 'ACTIVE', passwordHash: hashPassword(email === organizationConfig.adminEmail ? PASSWORD : STORE_PASSWORD) } });
}

async function ensureRole(organizationId: string, userId: string, roleId: string, scopeType: 'ORGANIZATION' | 'STORE', storeId?: string) {
  const existing = await prisma.userRole.findFirst({ where: { userId, roleId, scopeType, storeId: storeId ?? null } });
  if (existing) return existing;
  return prisma.userRole.create({ data: { organizationId, userId, roleId, scopeType, storeId } });
}

async function ensureCategory(organizationId: string, name: string, parentId?: string) {
  const existing = await prisma.category.findFirst({ where: { organizationId, name } });
  return existing ?? prisma.category.create({ data: { organizationId, name, parentId } });
}

async function ensureTaxGroup(organizationId: string, storeId: string, code: string, name: string, rateBps: number, hsnCode: string) {
  const existing = await prisma.taxGroup.findFirst({ where: { organizationId, storeId, code } });
  return existing
    ? prisma.taxGroup.update({ where: { id: existing.id }, data: { name, rateBps, hsnCode, includesTax: false, status: 'ACTIVE' } })
    : prisma.taxGroup.create({ data: { organizationId, storeId, code, name, rateBps, hsnCode, includesTax: false } });
}

async function ensureMovement(locationId: string, variantId: string, organizationId: string, actorUserId: string, quantity: number, unitCostCents: number) {
  const reason = '[seed:gcb] opening stock';
  const existing = await prisma.inventoryMovement.findFirst({ where: { locationId, variantId, reason } });
  if (existing) return existing;
  return prisma.inventoryMovement.create({ data: { organizationId, locationId, variantId, quantity, status: 'SELLABLE', type: 'RECEIPT', reason, unitCostCents, actorUserId } });
}

try {
  const { organizationId } = await seedFoundation(prisma, organizationConfig);
  const admin = await ensureUser(organizationId, organizationConfig.adminEmail, 'Maya', 'Al Harthy');
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { organizationId_name: { organizationId, name: 'Organisation Administrator' } } });
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { organizationId_name: { organizationId, name: 'Store Manager' } } });
  const cashierRole = await prisma.role.findUniqueOrThrow({ where: { organizationId_name: { organizationId, name: 'Cashier' } } });
  await ensureRole(organizationId, admin.id, adminRole.id, 'ORGANIZATION');

  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: {
      name: organizationConfig.organizationName, legalName: 'Golden Crust Bakery LLC', tradeName: 'Golden Crust Bakery',
      address: 'Al Khuwair, Muscat', addressDetails: json({ city: 'Muscat', region: 'Muscat' }),
      businessType: 'FOOD_RETAIL', countryCode: 'OM', currency: 'OMR', timezone: 'Asia/Muscat', taxRegime: 'VAT',
      taxProfileStatus: 'REGISTERED', gstin: 'OM1100000000', status: 'ACTIVE',
    },
  });
  await prisma.organizationSettings.upsert({
    where: { organizationId },
    create: { organizationId, settings: json({ enabledTenders: ['CASH', 'CARD', 'OTHER'], checkout: { allowNegativeStock: false, requireCustomerForCredit: true }, inventory: { negativeStockPolicy: 'BLOCK', lowStockAlerts: true }, productFields: productFieldSet, onboarding: { version: 2, currentStep: 2, completedSteps: [0, 1, 2], complete: true, required: false } }) },
    update: { settings: json({ enabledTenders: ['CASH', 'CARD', 'OTHER'], checkout: { allowNegativeStock: false, requireCustomerForCredit: true }, inventory: { negativeStockPolicy: 'BLOCK', lowStockAlerts: true }, productFields: productFieldSet, onboarding: { version: 2, currentStep: 2, completedSteps: [0, 1, 2], complete: true, required: false } }) },
  });

  const stores: StoreRecord[] = [];
  const managers: Awaited<ReturnType<typeof ensureUser>>[] = [];
  const cashiers: Awaited<ReturnType<typeof ensureUser>>[] = [];
  for (const [index, config] of storesConfig.entries()) {
    const store = await prisma.store.upsert({
      where: { organizationId_code: { organizationId, code: config.code } },
      create: { organizationId, code: config.code, name: config.name, address: config.address, city: config.city, region: config.region, postalCode: '', phone: config.phone, timezone: 'Asia/Muscat', operatingHours, billingSettings: json({ enabledTenders: ['CASH', 'CARD', 'OTHER'], receipt: { paperWidth: '80mm', showTax: true }, register: { requireOpenSession: true } }), fieldSettings: json({ productFields: { expiryDate: true, allergens: true } }) },
      update: { name: config.name, address: config.address, city: config.city, region: config.region, postalCode: '', phone: config.phone, timezone: 'Asia/Muscat', operatingHours, billingSettings: json({ enabledTenders: ['CASH', 'CARD', 'OTHER'], receipt: { paperWidth: '80mm', showTax: true }, register: { requireOpenSession: true } }), fieldSettings: json({ productFields: { expiryDate: true, allergens: true } }) },
    });
    stores.push(store);
    const stock = await prisma.stockLocation.upsert({ where: { organizationId_code: { organizationId, code: `${config.code}-STOCK` } }, create: { organizationId, storeId: store.id, code: `${config.code}-STOCK`, name: `${config.name} stockroom` }, update: { storeId: store.id, name: `${config.name} stockroom`, status: 'ACTIVE' } });
    await prisma.register.upsert({ where: { storeId_code: { storeId: store.id, code: 'REG-01' } }, create: { organizationId, storeId: store.id, code: 'REG-01', name: 'Front counter' }, update: { name: 'Front counter', status: 'ACTIVE' } });
    await prisma.register.upsert({ where: { storeId_code: { storeId: store.id, code: 'REG-02' } }, create: { organizationId, storeId: store.id, code: 'REG-02', name: 'Coffee counter' }, update: { name: 'Coffee counter', status: 'ACTIVE' } });
    await prisma.documentSequence.upsert({ where: { storeId_kind: { storeId: store.id, kind: 'SALE' } }, create: { organizationId, storeId: store.id, kind: 'SALE', lastValue: 100 }, update: { organizationId, lastValue: 100 } });
    await prisma.documentSequence.upsert({ where: { storeId_kind: { storeId: store.id, kind: 'RETURN' } }, create: { organizationId, storeId: store.id, kind: 'RETURN', lastValue: 10 }, update: { organizationId, lastValue: 10 } });
    await ensureTaxGroup(organizationId, store.id, 'VAT5', 'VAT 5%', 500, '190590');
    await ensureTaxGroup(organizationId, store.id, 'ZERO', 'Zero rated', 0, '190590');
    await prisma.userStore.upsert({ where: { userId_storeId: { userId: admin.id, storeId: store.id } }, create: { userId: admin.id, storeId: store.id, isDefault: index === 0 }, update: { isDefault: index === 0 } });
    const manager = await ensureUser(organizationId, `manager${index + 1}@goldencrust.example`, ['Noura', 'Salim', 'Aisha', 'Khalid', 'Fatma'][index], 'Manager');
    const cashier = await ensureUser(organizationId, `cashier${index + 1}@goldencrust.example`, ['Huda', 'Omar', 'Mariam', 'Yusuf', 'Sara'][index], 'Cashier');
    managers.push(manager); cashiers.push(cashier);
    await ensureRole(organizationId, manager.id, managerRole.id, 'STORE', store.id);
    await ensureRole(organizationId, cashier.id, cashierRole.id, 'STORE', store.id);
    await prisma.userStore.upsert({ where: { userId_storeId: { userId: manager.id, storeId: store.id } }, create: { userId: manager.id, storeId: store.id, isDefault: true }, update: { isDefault: true } });
    await prisma.userStore.upsert({ where: { userId_storeId: { userId: cashier.id, storeId: store.id } }, create: { userId: cashier.id, storeId: store.id, isDefault: true }, update: { isDefault: true } });
    await prisma.stockLocation.update({ where: { id: stock.id }, data: { status: 'ACTIVE' } });
  }

  const brand = await prisma.brand.upsert({ where: { organizationId_name: { organizationId, name: 'Golden Crust' } }, create: { organizationId, name: 'Golden Crust' }, update: { status: 'ACTIVE' } });
  const productTypeConfig = json({ categories: ['Breads', 'Viennoiserie', 'Cookies', 'Desserts', 'Cakes', 'Savoury', 'Beverages', 'Bundles'], brands: ['Golden Crust'], fields: [{ key: 'allergens', label: 'Allergens', type: 'text' }, { key: 'expiry_hours', label: 'Shelf life (hours)', type: 'number' }, { key: 'batch_number', label: 'Batch number', type: 'text' }] });
  const productType = await prisma.productType.upsert({ where: { organizationId_name: { organizationId, name: 'Bakery item' } }, create: { organizationId, name: 'Bakery item', description: 'Fresh bakery, beverage, and packaged food item', config: productTypeConfig }, update: { description: 'Fresh bakery, beverage, and packaged food item', config: productTypeConfig, status: 'ACTIVE' } });
  const categoryMap = new Map<string, string>();
  for (const name of [...new Set(products.map((product) => product[1]))]) categoryMap.set(name, (await ensureCategory(organizationId, name)).id);
  const pcs = await prisma.unitOfMeasure.upsert({ where: { organizationId_code: { organizationId, code: 'PCS' } }, create: { organizationId, code: 'PCS', name: 'Pieces' }, update: { name: 'Pieces', allowsDecimal: false } });
  await prisma.unitOfMeasure.upsert({ where: { organizationId_code: { organizationId, code: 'KG' } }, create: { organizationId, code: 'KG', name: 'Kilograms', allowsDecimal: true }, update: { name: 'Kilograms', allowsDecimal: true } });
  const variants: VariantRecord[] = [];
  for (const [index, [name, category, price, cost]] of products.entries()) {
    const allergens = category === 'Beverages' ? 'May contain milk' : 'Wheat, gluten';
    const expiryHours = category === 'Beverages' ? 24 : 48;
    const batchNumber = `GCB-${String(index + 1).padStart(3, '0')}`;
    const existingProduct = await prisma.product.findFirst({ where: { organizationId, name } });
    const product = existingProduct
      ? await prisma.product.update({ where: { id: existingProduct.id }, data: { categoryId: categoryMap.get(category), description: `Fresh ${name.toLowerCase()} prepared by Golden Crust Bakery.`, brand: 'Golden Crust', brandId: brand.id, productTypeId: productType.id, attributes: json({ allergens, expiry_hours: expiryHours }), customFields: json({ allergens, expiry_hours: expiryHours }), status: 'ACTIVE' } })
      : await prisma.product.create({ data: { organizationId, categoryId: categoryMap.get(category), name, description: `Fresh ${name.toLowerCase()} prepared by Golden Crust Bakery.`, brand: 'Golden Crust', brandId: brand.id, productTypeId: productType.id, attributes: json({ allergens, expiry_hours: expiryHours }), customFields: json({ allergens, expiry_hours: expiryHours }), status: 'ACTIVE' } });
    const sku = `GCB-${String(index + 1).padStart(3, '0')}`;
    const variant = await prisma.productVariant.upsert({ where: { organizationId_sku: { organizationId, sku } }, create: { organizationId, productId: product.id, sku, name: 'Standard', costCents: Math.round(cost * 1000), uomId: category === 'Beverages' ? pcs.id : pcs.id, openPrice: false, floorPriceCents: Math.round(price * 1000), customFields: json({ batch_number: batchNumber, packSize: category === 'Bundles' ? '1 box' : '1 piece' }), status: 'ACTIVE' }, update: { productId: product.id, name: 'Standard', costCents: Math.round(cost * 1000), uomId: pcs.id, floorPriceCents: Math.round(price * 1000), customFields: json({ batch_number: batchNumber, packSize: category === 'Bundles' ? '1 box' : '1 piece' }), status: 'ACTIVE' } });
    variants.push(variant);
    const barcode = `629${String(index + 1).padStart(9, '0')}`;
    await prisma.barcode.upsert({ where: { organizationId_code: { organizationId, code: barcode } }, create: { organizationId, variantId: variant.id, code: barcode }, update: { variantId: variant.id } });
    const amountCents = Math.round(price * 1000);
    const priceRecord = await prisma.variantPrice.findFirst({ where: { organizationId, variantId: variant.id, storeId: null } });
    if (priceRecord) await prisma.variantPrice.update({ where: { id: priceRecord.id }, data: { amountCents, currency: 'OMR', includesTax: false } });
    else await prisma.variantPrice.create({ data: { organizationId, variantId: variant.id, amountCents, currency: 'OMR', includesTax: false } });
  }

  for (const [storeIndex, store] of stores.entries()) {
    const vat = await prisma.taxGroup.findFirst({ where: { organizationId, storeId: store.id, code: 'VAT5' } });
    const stock = await prisma.stockLocation.findFirst({ where: { organizationId, storeId: store.id, code: `${storesConfig[storeIndex].code}-STOCK` } });
    if (!vat || !stock) throw new Error(`Missing stock or tax setup for ${store.code}`);
    for (const [variantIndex, variant] of variants.entries()) {
      await prisma.storeVariant.upsert({ where: { storeId_variantId: { storeId: store.id, variantId: variant.id } }, create: { organizationId, storeId: store.id, variantId: variant.id, status: 'ACTIVE', sourceType: 'STORE_CREATED', taxGroupId: vat.id, verifiedAt: new Date(), verifiedByUserId: managers[storeIndex].id, pinned: variantIndex < 5, pinnedRank: variantIndex + 1, customFields: json({ displayOrder: variantIndex + 1 }) }, update: { status: 'ACTIVE', taxGroupId: vat.id, verifiedAt: new Date(), verifiedByUserId: managers[storeIndex].id, pinned: variantIndex < 5, pinnedRank: variantIndex + 1 } });
      const quantity = storeIndex === 0 && variantIndex === 3 ? 2 : 30 + ((storeIndex + variantIndex) % 20);
      await ensureMovement(stock.id, variant.id, organizationId, managers[storeIndex].id, quantity, variant.costCents);
      await prisma.inventoryBalance.upsert({ where: { locationId_variantId_status: { locationId: stock.id, variantId: variant.id, status: 'SELLABLE' } }, create: { organizationId, locationId: stock.id, variantId: variant.id, status: 'SELLABLE', quantity, reorderPoint: variantIndex === 3 && storeIndex === 0 ? 5 : 10, safetyStock: 5 }, update: { quantity, reorderPoint: variantIndex === 3 && storeIndex === 0 ? 5 : 10, safetyStock: 5 } });
      const storePrice = await prisma.variantPrice.findFirst({ where: { organizationId, variantId: variant.id, storeId: store.id } });
      if (storeIndex === 0 && variantIndex % 4 === 0) {
        if (storePrice) await prisma.variantPrice.update({ where: { id: storePrice.id }, data: { amountCents: variant.floorPriceCents } });
        else await prisma.variantPrice.create({ data: { organizationId, variantId: variant.id, storeId: store.id, amountCents: variant.floorPriceCents, currency: 'OMR', includesTax: false } });
      }
    }
  }

  const vatForFirstStore = await prisma.taxGroup.findFirstOrThrow({ where: { organizationId, storeId: stores[0].id, code: 'VAT5' } });
  const paperBag = await prisma.charge.findFirst({ where: { organizationId, storeId: null, name: 'Paper bag' } });
  if (paperBag) await prisma.charge.update({ where: { id: paperBag.id }, data: { kind: 'FLAT', scope: 'PER_BILL', value: 50, taxGroupId: vatForFirstStore.id, status: 'ACTIVE' } });
  else await prisma.charge.create({ data: { organizationId, name: 'Paper bag', kind: 'FLAT', scope: 'PER_BILL', value: 50, taxGroupId: vatForFirstStore.id } });
  await prisma.discountReason.upsert({ where: { organizationId_storeId_code: { organizationId, storeId: stores[0].id, code: 'FRESHNESS' } }, create: { organizationId, storeId: stores[0].id, code: 'FRESHNESS', name: 'End of day freshness discount' }, update: { name: 'End of day freshness discount', status: 'ACTIVE' } });
  const breakfastRule = await prisma.priceRule.findFirst({ where: { organizationId, name: 'Breakfast bundle price' } });
  if (breakfastRule) await prisma.priceRule.update({ where: { id: breakfastRule.id }, data: { priority: 10, scope: 'CATEGORY', scopeId: categoryMap.get('Breads'), storeId: stores[0].id, minQuantity: 2, mode: 'PERCENT_OFF', value: 500, status: 'ACTIVE' } });
  else await prisma.priceRule.create({ data: { organizationId, name: 'Breakfast bundle price', priority: 10, scope: 'CATEGORY', scopeId: categoryMap.get('Breads'), storeId: stores[0].id, minQuantity: 2, mode: 'PERCENT_OFF', value: 500 } });
  const promotion = await prisma.promotion.findFirst({ where: { organizationId, code: 'WELCOME5', storeId: null } }) ?? await prisma.promotion.create({ data: { organizationId, code: 'WELCOME5', type: 'PERCENT', value: 5, minSubtotalCents: 5000, usageLimit: 1000, startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2027-01-01T00:00:00Z'), scope: 'ALL', autoApply: false, stackable: false, perCustomerLimit: 1 } });
  const bundle = await prisma.bundle.upsert({ where: { organizationId_sku: { organizationId, sku: 'GCB-BREAKFAST' } }, create: { organizationId, name: 'Breakfast box', sku: 'GCB-BREAKFAST', priceCents: 4500 }, update: { name: 'Breakfast box', priceCents: 4500, status: 'ACTIVE' } });
  for (const index of [0, 6, 30]) await prisma.bundleComponent.upsert({ where: { bundleId_variantId: { bundleId: bundle.id, variantId: variants[index].id } }, create: { bundleId: bundle.id, variantId: variants[index].id, quantity: 1 }, update: { quantity: 1 } });
  await prisma.approvalPolicy.upsert({ where: { organizationId_action: { organizationId, action: 'DISCOUNT' } }, create: { organizationId, action: 'DISCOUNT', thresholdPercent: 10 }, update: { thresholdPercent: 10, status: 'ACTIVE' } });
  await prisma.approvalPolicy.upsert({ where: { organizationId_action: { organizationId, action: 'REFUND' } }, create: { organizationId, action: 'REFUND', thresholdCents: 5000 }, update: { thresholdCents: 5000, status: 'ACTIVE' } });

  const customerData = [
    { name: 'Amina Al Balushi', phone: '+968 9211 1001', email: 'amina@example.com', groupName: 'Loyalty', pointsBalance: 120, walletBalanceCents: 500, consentMarketing: true },
    { name: 'Oasis Catering LLC', phone: '+968 2411 2002', email: 'accounts@oasiscatering.example', groupName: 'Business', isBusiness: true, legalName: 'Oasis Catering LLC', taxNumber: 'OM1200000001', billingAddress: 'Ruwi, Muscat', stateCode: 'MU' },
    { name: 'Khalid Al Wahaibi', phone: '+968 9211 1003', email: 'khalid@example.com', groupName: 'General' },
  ];
  const customers = [];
  for (const data of customerData) {
    const existing = await prisma.customer.findFirst({ where: { organizationId, email: data.email } });
    const customer = existing ? await prisma.customer.update({ where: { id: existing.id }, data }) : await prisma.customer.create({ data: { organizationId, ...data } });
    customers.push(customer);
  }
  const loyaltyEntry = await prisma.customerLedger.findFirst({ where: { customerId: customers[0].id, referenceId: 'seed:gcb:loyalty' } });
  if (loyaltyEntry) await prisma.customerLedger.update({ where: { id: loyaltyEntry.id }, data: { type: 'POINTS_EARN', points: 120, amountCents: 0 } });
  else await prisma.customerLedger.create({ data: { customerId: customers[0].id, type: 'POINTS_EARN', points: 120, amountCents: 0, referenceId: 'seed:gcb:loyalty' } });

  const historicalDate = new Date('2026-10-15T17:00:00.000Z');
  const sessions: { store: StoreRecord; registerId: string; sessionId: string; saleId: string }[] = [];
  for (const [index, store] of stores.entries()) {
    const register = await prisma.register.findFirstOrThrow({ where: { storeId: store.id, code: 'REG-01' } });
    const manager = managers[index];
    const existingSession = await prisma.registerSession.findFirst({ where: { storeId: store.id, registerId: register.id, closeReason: '[seed:gcb] historical close' } });
    const session = existingSession ?? await prisma.registerSession.create({ data: { organizationId, storeId: store.id, registerId: register.id, openedById: manager.id, status: 'CLOSED', openingFloatCents: 10000, expectedCashCents: 13250, countedCashCents: 13250, varianceCents: 0, closedById: manager.id, closeApprovedById: admin.id, closeReason: '[seed:gcb] historical close', forcedClosed: false, openedAt: historicalDate, closedAt: new Date(historicalDate.getTime() + 10 * 60 * 60 * 1000) } });
    const productVariant = variants[index];
    const total = 1900 + index * 100;
    const existingSale = await prisma.sale.findUnique({ where: { organizationId_clientSaleId: { organizationId, clientSaleId: `gcb-demo-sale-${index + 1}` } }, include: { lines: true } });
    const sale = existingSale ?? await prisma.sale.create({ data: { organizationId, storeId: store.id, registerId: register.id, sessionId: session.id, clientSaleId: `gcb-demo-sale-${index + 1}`, receiptNumber: `GCB-${String(index + 1).padStart(6, '0')}`, status: 'COMPLETED', subtotalCents: total, discountCents: index === 0 ? 100 : 0, taxCents: Math.round((total - (index === 0 ? 100 : 0)) * 0.05), roundingCents: 0, chargeCents: index === 0 ? 50 : 0, charges: json(index === 0 ? [{ name: 'Paper bag', amountCents: 50 }] : []), promotions: json(index === 0 ? [{ promotionId: promotion.id, code: promotion.code, discountCents: 100 }] : []), totalCents: total - (index === 0 ? 100 : 0) + Math.round((total - (index === 0 ? 100 : 0)) * 0.05) + (index === 0 ? 50 : 0), notes: '[seed:gcb] sample sale', customFields: json({ channel: 'COUNTER', orderType: 'TAKEAWAY' }), customerId: customers[index % customers.length].id, createdById: manager.id, handledById: cashiers[index].id, createdAt: historicalDate, lines: { create: { variantId: productVariant.id, sku: productVariant.sku, name: productVariant.name, quantity: 1, unitPriceCents: total, unitCostCents: productVariant.costCents, discountCents: index === 0 ? 100 : 0, taxRateBps: 500, hsnCode: '190590', taxCents: Math.round((total - (index === 0 ? 100 : 0)) * 0.05), lineTotalCents: total - (index === 0 ? 100 : 0) + Math.round((total - (index === 0 ? 100 : 0)) * 0.05) } } } });
    if (!existingSale) {
      await prisma.salePayment.create({ data: { saleId: sale.id, tenderType: index % 2 === 0 ? 'CASH' : 'CARD', amountCents: sale.totalCents, tenderedCents: sale.totalCents, changeCents: 0, reference: index % 2 === 0 ? 'Cash drawer' : 'Terminal 01' } });
      await prisma.cashMovement.create({ data: { organizationId, sessionId: session.id, type: 'PAID_IN', amountCents: index % 2 === 0 ? sale.totalCents : 0, reason: '[seed:gcb] sale cash', actorUserId: manager.id, clientMovementId: `gcb-sale-cash-${index + 1}` } });
    }
    sessions.push({ store, registerId: register.id, sessionId: session.id, saleId: sale.id });
  }
  const firstSale = await prisma.sale.findUniqueOrThrow({ where: { id: sessions[0].saleId }, include: { lines: true } });
  const existingReturn = await prisma.saleReturn.findFirst({ where: { storeId: stores[0].id, creditNoteNumber: 'GCB-CN-000001' } });
  if (!existingReturn) {
    await prisma.saleReturn.create({ data: { organizationId, originalSaleId: firstSale.id, storeId: stores[0].id, sessionId: sessions[0].sessionId, creditNoteNumber: 'GCB-CN-000001', refundTender: 'CASH', subtotalCents: 900, taxCents: 45, totalCents: 945, reason: 'Customer changed order', createdById: managers[0].id, lines: { create: { saleLineId: firstSale.lines[0].id, variantId: firstSale.lines[0].variantId, quantity: 1, restockStatus: 'SELLABLE', amountCents: 945 } } } });
  }

  const held = await prisma.heldSale.findFirst({ where: { organizationId, clientHoldId: 'gcb-sample-hold' } });
  if (!held) await prisma.heldSale.create({ data: { organizationId, storeId: stores[1].id, registerId: sessions[1].registerId, clientHoldId: 'gcb-sample-hold', payload: json({ customerId: customers[1].id, items: [{ variantId: variants[1].id, quantity: 2 }], note: 'Catering pickup' }), createdById: cashiers[1].id, expiresAt: new Date('2026-12-31T23:59:59Z') } });
  const approval = await prisma.approval.findFirst({ where: { organizationId, action: 'DISCOUNT', referenceId: 'gcb-demo-sale-1' } });
  if (!approval) await prisma.approval.create({ data: { organizationId, action: 'DISCOUNT', referenceId: 'gcb-demo-sale-1', requestedById: cashiers[0].id, approvedById: managers[0].id, reason: 'End of day freshness discount', storeId: stores[0].id, payload: json({ discountCents: 100 }), status: 'APPROVED', decidedAt: historicalDate } });

  const transfer = await prisma.transfer.findFirst({ where: { organizationId, notes: '[seed:gcb] inter-store replenishment' } });
  if (!transfer) {
    const fromLocation = await prisma.stockLocation.findFirstOrThrow({ where: { storeId: stores[0].id } });
    const toLocation = await prisma.stockLocation.findFirstOrThrow({ where: { storeId: stores[1].id } });
    await prisma.transfer.create({ data: { organizationId, fromLocationId: fromLocation.id, toLocationId: toLocation.id, status: 'RECEIVED', notes: '[seed:gcb] inter-store replenishment', createdById: managers[0].id, lines: { create: { variantId: variants[0].id, requestedQuantity: 10, dispatchedQuantity: 10, receivedQuantity: 10 } } } });
  }
  const distribution = await prisma.distribution.findFirst({ where: { organizationId, notes: '[seed:gcb] new store launch' } });
  if (!distribution) {
    const distributionTax = await prisma.taxGroup.findFirstOrThrow({ where: { organizationId, storeId: stores[2].id, code: 'VAT5' } });
    await prisma.distribution.create({ data: { organizationId, toStoreId: stores[2].id, status: 'RECEIVED', notes: '[seed:gcb] new store launch', createdByUserId: admin.id, lines: { create: variants.slice(0, 3).map((variant) => ({ variantId: variant.id, quantity: 12, suggestedPriceCents: 1900, suggestedTaxGroupId: distributionTax.id, acceptedQuantity: 12, rejectedQuantity: 0 })) } } });
  }

  const attendance = await prisma.staffAttendance.findFirst({ where: { organizationId, storeId: stores[0].id, userId: cashiers[0].id, clockOutReason: '[seed:gcb] sample shift' } });
  if (!attendance) await prisma.staffAttendance.create({ data: { organizationId, storeId: stores[0].id, userId: cashiers[0].id, status: 'CLOSED', clockedInAt: new Date('2026-10-15T05:45:00Z'), clockedOutAt: new Date('2026-10-15T14:00:00Z'), clockedInById: managers[0].id, clockedOutById: managers[0].id, clockOutReason: '[seed:gcb] sample shift' } });
  const businessDate = new Date('2026-10-15T00:00:00Z');
  const dayClose = await prisma.storeDayClose.upsert({ where: { storeId_businessDate: { storeId: stores[0].id, businessDate } }, create: { organizationId, storeId: stores[0].id, businessDate, version: 1, status: 'CLOSED', snapshot: json({ sales: 1, grossCents: firstSale.totalCents, cashExpectedCents: 13250, varianceCents: 0 }), closeReason: '[seed:gcb] sample day close', closedById: managers[0].id, closedAt: new Date('2026-10-15T20:00:00Z') }, update: { snapshot: json({ sales: 1, grossCents: firstSale.totalCents, cashExpectedCents: 13250, varianceCents: 0 }), status: 'CLOSED', version: 1, closeReason: '[seed:gcb] sample day close' } });
  await prisma.dayCloseRevision.upsert({ where: { dayCloseId_version: { dayCloseId: dayClose.id, version: 1 } }, create: { organizationId, dayCloseId: dayClose.id, version: 1, snapshot: json({ sales: 1, grossCents: firstSale.totalCents }), reason: '[seed:gcb] initial close', createdById: managers[0].id }, update: { snapshot: json({ sales: 1, grossCents: firstSale.totalCents }), reason: '[seed:gcb] initial close' } });
  const exportJob = await prisma.reportExportJob.findFirst({ where: { organizationId, filters: { equals: json({ seed: 'gcb', report: 'sales' }) } as any } });
  if (!exportJob) await prisma.reportExportJob.create({ data: { organizationId, storeId: stores[0].id, requestedById: admin.id, format: 'CSV', status: 'READY', filters: json({ seed: 'gcb', report: 'sales' }), resultData: Buffer.from('receipt,total\nGCB-000001,20.48\n'), attempts: 1, startedAt: historicalDate, completedAt: new Date(historicalDate.getTime() + 60_000), expiresAt: new Date('2027-01-01T00:00:00Z') } });
  if (!(await prisma.alert.findUnique({ where: { activeDedupeKey: 'gcb:low-stock:store-1:variant-4' } }))) await prisma.alert.create({ data: { organizationId, storeId: stores[0].id, type: 'LOW_STOCK', severity: 'MEDIUM', message: 'Brioche Loaf is below its reorder point.', referenceId: variants[3].id, activeDedupeKey: 'gcb:low-stock:store-1:variant-4', status: 'OPEN' } });
  if (!(await prisma.auditLog.findFirst({ where: { organizationId, action: 'seed.completed', entityType: 'Organization', entityId: organizationId } }))) await prisma.auditLog.create({ data: { organizationId, actorUserId: admin.id, action: 'seed.completed', entityType: 'Organization', entityId: organizationId, metadata: json({ seed: 'golden-crust-bakery', stores: stores.length, variants: variants.length }) } });
  if (!(await prisma.outboxEvent.findFirst({ where: { organizationId, eventType: 'organization.seeded', aggregateId: organizationId } }))) await prisma.outboxEvent.create({ data: { organizationId, eventType: 'organization.seeded', aggregateId: organizationId, payload: json({ seed: 'golden-crust-bakery', version: 1 }), status: 'PENDING' } });

  const cardSale = await prisma.sale.findUnique({ where: { id: sessions[1].saleId } });
  const paymentAttempt = await prisma.paymentAttempt.findFirst({ where: { organizationId, idempotencyKey: 'gcb-card-attempt-1' } });
  const capturedAttempt = paymentAttempt ?? await prisma.paymentAttempt.create({ data: { organizationId, storeId: stores[1].id, provider: 'demo-terminal', tenderType: 'CARD', amountCents: cardSale?.totalCents ?? firstSale.totalCents, status: 'CAPTURED', providerRef: 'GCB-DEMO-001', idempotencyKey: 'gcb-card-attempt-1', clientSaleId: 'gcb-demo-sale-2', createdById: cashiers[1].id } });
  if (cardSale) {
    const cardPayment = await prisma.salePayment.findFirst({ where: { saleId: cardSale.id, tenderType: 'CARD' } });
    if (cardPayment && !cardPayment.attemptId) await prisma.salePayment.update({ where: { id: cardPayment.id }, data: { attemptId: capturedAttempt.id } });
  }
  const failedAttempt = await prisma.paymentAttempt.findFirst({ where: { organizationId, idempotencyKey: 'gcb-card-attempt-failed' } });
  if (!failedAttempt) await prisma.paymentAttempt.create({ data: { organizationId, storeId: stores[0].id, provider: 'demo-terminal', tenderType: 'CARD', amountCents: 2500, status: 'FAILED', providerRef: 'GCB-DEMO-FAILED', idempotencyKey: 'gcb-card-attempt-failed', clientSaleId: '', failureReason: 'Demo declined payment', createdById: cashiers[0].id } });
  const redemption = await prisma.promotionRedemption.findFirst({ where: { promotionId: promotion.id, saleId: firstSale.id } });
  if (!redemption) await prisma.promotionRedemption.create({ data: { promotionId: promotion.id, saleId: firstSale.id, customerId: firstSale.customerId, discountCents: 100 } });

  console.log(JSON.stringify({
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    admin: { email: organizationConfig.adminEmail, password: PASSWORD },
    staffPassword: STORE_PASSWORD,
    stores: stores.map((store) => store.code),
    products: variants.length,
    productsPerStore: variants.length,
    seededFeatures: ['catalogue', 'pricing', 'tax', 'inventory', 'registers', 'sales', 'payments', 'returns', 'customers', 'promotions', 'bundles', 'transfers', 'distributions', 'approvals', 'attendance', 'day-close', 'reports', 'alerts', 'audit', 'outbox'],
  }, null, 2));
} finally {
  await prisma.$disconnect();
}

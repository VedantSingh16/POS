import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedFoundation } from '../src/bootstrap/foundation.js';

loadEnv({ path: '../../.env' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const ORGANIZATION = {
  organizationName: 'Verification Retail Group',
  organizationSlug: 'verification-retail-group',
  maxStores: 5,
  adminEmail: 'verification-admin@deltcrm.local',
  adminPassword: 'VerificationPass123!',
};

const operatingHours = {
  monday: { open: '08:00', close: '22:00' },
  tuesday: { open: '08:00', close: '22:00' },
  wednesday: { open: '08:00', close: '22:00' },
  thursday: { open: '08:00', close: '22:00' },
  friday: { open: '08:00', close: '22:00' },
  saturday: { open: '09:00', close: '23:00' },
  sunday: { open: '09:00', close: '21:00' },
};

try {
  const { organizationId } = await seedFoundation(prisma, ORGANIZATION);
  const admin = await prisma.user.findUniqueOrThrow({ where: { organizationId_email: { organizationId, email: ORGANIZATION.adminEmail } } });
  const storeManagerRole = await prisma.role.findUniqueOrThrow({ where: { organizationId_name: { organizationId, name: 'Store Manager' } } });
  await prisma.organization.update({ where: { id: organizationId }, data: { name: ORGANIZATION.organizationName, countryCode: 'OM', currency: 'OMR', timezone: 'Asia/Muscat', taxRegime: 'VAT', taxProfileStatus: 'LEGACY', address: '' } });
  await prisma.organizationSettings.update({ where: { organizationId }, data: { settings: { enabledTenders: ['CASH'], onboarding: { version: 2, currentStep: 2, completedSteps: [0, 1], complete: true, required: false } } } });

  const category = await prisma.category.findFirst({ where: { organizationId, name: 'Verification products' } }) ?? await prisma.category.create({ data: { organizationId, name: 'Verification products' } });
  const unit = await prisma.unitOfMeasure.upsert({ where: { organizationId_code: { organizationId, code: 'PCS' } }, create: { organizationId, code: 'PCS', name: 'Pieces' }, update: {} });

  const stores = [];
  for (let index = 1; index <= 5; index += 1) {
    const code = `VERIFY-${String(index).padStart(2, '0')}`;
    const name = `Verification Store ${index}`;
    const store = await prisma.store.upsert({
      where: { organizationId_code: { organizationId, code } },
      create: { organizationId, code, name, address: `${index} Market Street`, phone: `+9689123456${String(index).padStart(1, '0')}`, timezone: 'Asia/Muscat', operatingHours, billingSettings: { enabledTenders: ['CASH'] } },
      update: { name, address: `${index} Market Street`, timezone: 'Asia/Muscat', operatingHours },
    });
    await prisma.stockLocation.upsert({ where: { organizationId_code: { organizationId, code: `${code}-STOCKROOM` } }, create: { organizationId, storeId: store.id, code: `${code}-STOCKROOM`, name: `${name} Stockroom` }, update: { storeId: store.id, status: 'ACTIVE' } });
    await prisma.register.upsert({ where: { storeId_code: { storeId: store.id, code: 'REG-01' } }, create: { organizationId, storeId: store.id, code: 'REG-01', name: 'Front Register' }, update: { name: 'Front Register', status: 'ACTIVE' } });
    await prisma.userStore.upsert({ where: { userId_storeId: { userId: admin.id, storeId: store.id } }, create: { userId: admin.id, storeId: store.id, isDefault: index === 1 }, update: { isDefault: index === 1 } });
    await prisma.userRole.upsert({ where: { userId_roleId_scopeType_storeId: { userId: admin.id, roleId: storeManagerRole.id, scopeType: 'STORE', storeId: store.id } }, create: { organizationId, userId: admin.id, roleId: storeManagerRole.id, scopeType: 'STORE', storeId: store.id }, update: {} });
    stores.push(store);
  }

  const variants = [];
  for (let index = 1; index <= 25; index += 1) {
    const sku = `VERIFY-SKU-${String(index).padStart(3, '0')}`;
    const product = await prisma.product.findFirst({ where: { organizationId, name: `Verification Product ${index}` } }) ?? await prisma.product.create({ data: { organizationId, categoryId: category.id, name: `Verification Product ${index}`, description: 'Seeded verification product', status: 'ACTIVE' } });
    const variant = await prisma.productVariant.upsert({ where: { organizationId_sku: { organizationId, sku } }, create: { organizationId, productId: product.id, sku, name: `Standard ${index}`, uomId: unit.id, status: 'ACTIVE', costCents: 1000 + index * 10 }, update: { productId: product.id, uomId: unit.id, status: 'ACTIVE' } });
    await prisma.variantPrice.findFirst({ where: { organizationId, variantId: variant.id, storeId: null } }) ?? await prisma.variantPrice.create({ data: { organizationId, variantId: variant.id, amountCents: 2000 + index * 100, currency: 'OMR', includesTax: false } });
    variants.push(variant);
  }

  for (const store of stores) {
    for (const variant of variants) {
      await prisma.storeVariant.upsert({ where: { storeId_variantId: { storeId: store.id, variantId: variant.id } }, create: { organizationId, storeId: store.id, variantId: variant.id, status: 'ACTIVE', sourceType: 'STORE_CREATED' }, update: { status: 'ACTIVE' } });
    }
  }

  console.log(JSON.stringify({ organizationId, adminEmail: ORGANIZATION.adminEmail, adminPassword: ORGANIZATION.adminPassword, stores: stores.map((store) => store.code), productsPerStore: variants.length }));
} finally {
  await prisma.$disconnect();
}

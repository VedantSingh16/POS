import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { UserContext } from '../auth/auth.types.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { finiteNumber, isUuid, JsonObject, money, oneOf, optionalString, requiredString, uuid } from '../common/input.js';
import { isUniqueViolation, num, Tx } from '../database/db.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  AlertSeverity,
  CashMovementType,
  CustomerLedgerType,
  InventoryMovementType,
  InventoryStatus,
  Prisma,
  PromotionType,
  TenderType,
  TransferStatus,
} from '../generated/prisma/client.js';
import { PHASES } from './pos-features.js';
import { buildInvoicePdf } from './invoice-pdf.js';
import { splitInclusive, taxOnExclusive } from '@pos/shared/gst';
import { verifyPassword } from '../security/password.js';

type LineInput = { variantId?: unknown; quantity?: unknown; note?: unknown; discountCents?: unknown; discountPercent?: unknown; discountReason?: unknown };

const SELLABLE_STATUSES = ['ACTIVE', 'SEASONAL'] as const;
const TENDERS = Object.values(TenderType) as TenderType[];
const INVENTORY_STATUSES = Object.values(InventoryStatus) as InventoryStatus[];
const CASH_MOVEMENTS = Object.values(CashMovementType) as CashMovementType[];
const OUTFLOW_MOVEMENTS: CashMovementType[] = ['PAID_OUT', 'DROP', 'PICKUP'];
const TRANSFER_STATUSES = Object.values(TransferStatus) as TransferStatus[];
const TRANSFER_FLOW: Record<TransferStatus, TransferStatus[]> = {
  REQUESTED: ['DISPATCHED', 'IN_TRANSIT', 'CANCELLED'],
  DISPATCHED: ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

const SESSION_INCLUDE = {
  register: { select: { code: true, name: true } },
  openedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.RegisterSessionInclude;

const TRANSFER_INCLUDE = {
  fromLocation: { select: { name: true } },
  toLocation: { select: { name: true } },
  lines: { include: { variant: { select: { sku: true, name: true, product: { select: { name: true } } } } } },
} satisfies Prisma.TransferInclude;

type PricedLine = {
  variantId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  taxRateBps: number;
  hsnCode: string;
  taxCents: number;
  netCents: number;
  lineTotalCents: number;
  discountCents: number;
  discountReason: string;
  note: string;
};

type SaleWithDetails = Prisma.SaleGetPayload<{ include: { lines: true; payments: true } }>;

const formatRupees = (cents: number) => `₹${(cents / 100).toFixed(2)}`;

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  featureStatus() {
    return { plan: 'plan3-mvp', generatedAt: new Date().toISOString(), phases: PHASES };
  }

  async overview(context: UserContext, requestedStoreId?: string) {
    const storeId = requestedStoreId ? uuid(requestedStoreId, 'storeId') : undefined;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['store.overview.view'], storeId);
    }
    const reachable = await this.authorization.permittedStoreIds(context, 'store.overview.view');
    const scopedStoreIds = storeId ? [storeId] : reachable;
    const isScoped = scopedStoreIds !== undefined;
    const storeFilter = scopedStoreIds ? { storeId: { in: scopedStoreIds } } : {};
    const locationFilter = scopedStoreIds ? { location: { storeId: { in: scopedStoreIds } } } : {};
    const [products, variants, sales, returns, customers, inventoryMovements, alerts] = await Promise.all([
      isScoped
        ? this.prisma.product.count({ where: { organizationId: context.organizationId, variants: { some: { storeVariants: { some: { storeId: { in: scopedStoreIds ?? [] }, status: 'ACTIVE' } } } } } })
        : this.prisma.product.count({ where: { organizationId: context.organizationId } }),
      isScoped
        ? this.prisma.productVariant.count({ where: { organizationId: context.organizationId, storeVariants: { some: { storeId: { in: scopedStoreIds ?? [] }, status: 'ACTIVE' } } } })
        : this.prisma.productVariant.count({ where: { organizationId: context.organizationId } }),
      this.prisma.sale.count({ where: { organizationId: context.organizationId, ...(storeId ? { storeId } : storeFilter) } }),
      this.prisma.saleReturn.count({ where: { organizationId: context.organizationId, ...(storeId ? { storeId } : storeFilter) } }),
      context.isOrganisationAdministrator ? this.prisma.customer.count({ where: { organizationId: context.organizationId } }) : Promise.resolve(0),
      this.prisma.inventoryMovement.count({ where: { organizationId: context.organizationId, ...locationFilter } }),
      this.prisma.alert.count({ where: { organizationId: context.organizationId, ...(storeId ? { storeId } : scopedStoreIds ? { storeId: { in: scopedStoreIds } } : {}) } }),
    ]);
    return {
      phases: PHASES,
      counts: { products, variants, sales, returns, customers, inventoryMovements, alerts },
      capabilities: ['POS_CORE', 'POS_INVENTORY', 'POS_REFUNDS', 'POS_CUSTOMERS', 'POS_REPORTING_ADVANCED', 'POS_MULTI_LOCATION'],
    };
  }

  // ───────────── Catalogue search ─────────────

  async searchProducts(context: UserContext, query = '', requestedStoreId?: string) {
    const term = query.trim();
    const storeId = requestedStoreId ? uuid(requestedStoreId, 'storeId') : context.defaultStoreId;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    }
    const variants = await this.prisma.productVariant.findMany({
      where: {
        organizationId: context.organizationId,
        status: { in: [...SELLABLE_STATUSES] },
        ...(storeId ? { storeVariants: { some: { storeId, status: 'ACTIVE' as const } } } : {}),
        ...(term
          ? {
            OR: [
              { sku: { contains: term, mode: 'insensitive' } },
              { name: { contains: term, mode: 'insensitive' } },
              { product: { brand: { contains: term, mode: 'insensitive' } } },
              { product: { name: { contains: term, mode: 'insensitive' } } },
              { barcodes: { some: { code: { contains: term, mode: 'insensitive' } } } },
            ],
          }
          : {}),
      },
      include: {
        product: { select: { name: true, brand: true, category: { select: { id: true, name: true } } } },
        taxGroup: { select: { rateBps: true } },
        storeVariants: { where: { storeId: storeId ?? '00000000-0000-0000-0000-000000000000' }, select: { taxGroup: { select: { rateBps: true } } } },
        barcodes: { select: { code: true }, orderBy: { code: 'asc' } },
        prices: this.currentPriceFilter(storeId),
      },
      orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
      take: 100,
    });
    const balances = storeId
      ? await this.prisma.inventoryBalance.findMany({
        where: { organizationId: context.organizationId, variantId: { in: variants.map((variant) => variant.id) }, location: { storeId } },
        select: { variantId: true, status: true, quantity: true },
      })
      : [];
    const stockByVariant = new Map<string, number>();
    for (const balance of balances) if (balance.status === 'SELLABLE') stockByVariant.set(balance.variantId, (stockByVariant.get(balance.variantId) ?? 0) + Number(balance.quantity));
    return variants.map((variant) => ({
      variantId: variant.id,
      sku: variant.sku,
      variantName: variant.name,
      productName: variant.product.name,
      brand: variant.product.brand,
      categoryId: variant.product.category?.id ?? null,
      categoryName: variant.product.category?.name ?? '',
      priceCents: this.pickPrice(variant.prices, storeId)?.amountCents ?? 0,
      includesTax: this.pickPrice(variant.prices, storeId)?.includesTax ?? false,
      barcode: variant.barcodes[0]?.code ?? '',
      barcodes: variant.barcodes.map((barcode) => barcode.code),
      taxBps: (variant.storeVariants[0]?.taxGroup ?? variant.taxGroup)?.rateBps ?? 0,
      stock: stockByVariant.get(variant.id) ?? 0,
    }));
  }

  async listCategories(context: UserContext, requestedStoreId?: string) {
    const storeId = requestedStoreId ? uuid(requestedStoreId, 'storeId') : undefined;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    }
    const reachable = storeId ? [storeId] : await this.authorization.permittedStoreIds(context, 'catalog.view');
    return this.prisma.category.findMany({
      where: {
        organizationId: context.organizationId,
        ...(reachable ? { products: { some: { variants: { some: { storeVariants: { some: { storeId: { in: reachable }, status: 'ACTIVE' } } } } } } } : {}),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  // ───────────── Store catalogue (each store sells its own set of products) ─────────────

  private async ensureStoreProduct(
    tx: Tx,
    organizationId: string,
    storeId: string,
    variantId: string,
    options?: { status?: 'ACTIVE' | 'PENDING_VERIFICATION'; sourceType?: 'ORG_DISTRIBUTION' | 'STORE_CREATED' },
  ) {
    const status = options?.status ?? 'ACTIVE';
    const sourceType = options?.sourceType ?? 'STORE_CREATED';
    await tx.storeVariant.upsert({
      where: { storeId_variantId: { storeId, variantId } },
      // Do not downgrade an ACTIVE row to PENDING; keep the existing status if the product is already live.
      create: { organizationId, storeId, variantId, status, sourceType },
      update: {},
    });
  }

  async listStoreProducts(context: UserContext, requestedStoreId: string) {
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    const [variants, assignments, balances] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { organizationId: context.organizationId },
        include: { product: { select: { name: true, brand: true, category: { select: { name: true } } } }, taxGroup: { select: { name: true, rateBps: true } }, prices: this.currentPriceFilter(storeId) },
        orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
      }),
      this.prisma.storeVariant.findMany({ where: { storeId }, include: { taxGroup: { select: { id: true, name: true, rateBps: true } } } }),
      this.prisma.inventoryBalance.findMany({ where: { organizationId: context.organizationId, status: 'SELLABLE', location: { storeId } }, select: { variantId: true, quantity: true } }),
    ]);
    const assigned = new Map(assignments.map((row) => [row.variantId, row.status]));
    const storeTax = new Map(assignments.map((row) => [row.variantId, row.taxGroup]));
    const stock = new Map<string, number>();
    for (const balance of balances) stock.set(balance.variantId, (stock.get(balance.variantId) ?? 0) + Number(balance.quantity));
    return variants.map((variant) => {
      const storePrice = variant.prices.filter((price) => price.storeId === storeId).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
      return {
        variantId: variant.id,
        sku: variant.sku,
        name: `${variant.product.name} ${variant.name}`.trim(),
        brand: variant.product.brand,
        category: variant.product.category?.name ?? '',
        assigned: assigned.has(variant.id),
        status: assigned.get(variant.id) ?? null,
        priceCents: this.pickPrice(variant.prices, storeId)?.amountCents ?? 0,
        storePriceCents: storePrice?.amountCents ?? null,
        storeTaxGroupId: storeTax.get(variant.id)?.id ?? null,
        taxGroupName: (storeTax.get(variant.id) ?? variant.taxGroup)?.name ?? null,
        taxRatePercent: ((storeTax.get(variant.id) ?? variant.taxGroup)?.rateBps ?? 0) / 100,
        stock: stock.get(variant.id) ?? 0,
      };
    });
  }

  async assignStoreProducts(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.manage'], storeId);
    const variantIds = [...new Set((Array.isArray(input.variantIds) ? input.variantIds : []).map((id) => uuid(id, 'variantId')))];
    if (!variantIds.length) throw new BadRequestException('Select at least one product');
    if (variantIds.length > 500) throw new BadRequestException('Add at most 500 products at once');
    if (input.priceCents !== undefined && input.priceCents !== null) throw new BadRequestException('The base price is set by the organisation and cannot be changed for one store');
    const openingQuantity = input.openingQuantity === undefined || input.openingQuantity === null ? 0 : finiteNumber(input.openingQuantity, 'openingQuantity');
    if (openingQuantity < 0) throw new BadRequestException('Opening quantity cannot be negative');
    if (openingQuantity > 0 && variantIds.length > 1) throw new BadRequestException('Opening stock can only be set when adding one product');
    await this.assertVariantsInOrganization(context.organizationId, variantIds);
    await this.prisma.$transaction(async (tx) => {
      for (const variantId of variantIds) {
        await this.ensureStoreProduct(tx, context.organizationId, storeId, variantId);
        if (openingQuantity > 0) {
          const location = await this.storeLocation(tx, context.organizationId, storeId);
          if (!location) throw new BadRequestException('This store has no stock location yet. Create one on the Inventory page first.');
          await this.postInventory(tx, context, location.id, variantId, openingQuantity, 'RECEIPT', null, 'Opening stock', 0, 'SELLABLE');
        }
      }
      await this.audit.record(context, 'store-catalogue.assigned', 'Store', storeId, { variantIds, openingQuantity }, tx);
    });
    return { storeId, assigned: variantIds.length };
  }

  async updateStoreProduct(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    const variantId = uuid(input.variantId, 'variantId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.manage'], storeId);
    const current = await this.prisma.storeVariant.findUnique({ where: { storeId_variantId: { storeId, variantId } } });
    if (!current) throw new NotFoundException('This product is not in the store catalogue');
    const status = input.status === undefined ? undefined : oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status');
    if (input.priceCents !== undefined && input.priceCents !== null) throw new BadRequestException('The base price is set by the organisation and cannot be changed for one store');
    const taxGroupId = input.taxGroupId === undefined ? undefined : input.taxGroupId === null ? null : uuid(input.taxGroupId, 'taxGroupId');
    if (taxGroupId) await this.assertTaxGroupUsable(context.organizationId, storeId, taxGroupId);
    await this.prisma.$transaction(async (tx) => {
      if (status || taxGroupId !== undefined) await tx.storeVariant.update({ where: { id: current.id }, data: { ...(status ? { status } : {}), ...(taxGroupId !== undefined ? { taxGroupId } : {}) } });
      await this.audit.record(context, 'store-catalogue.updated', 'Store', storeId, { variantId, status, taxGroupId }, tx);
    });
    return { storeId, variantId, status: status ?? current.status };
  }

  // ───────────── Store-scoped product creation ─────────────

  /** A store manager creates a product that belongs to this store (and goes into the organisation catalogue). */
  async createStoreProduct(context: UserContext, requestedStoreId: string, input: JsonObject) {
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.manage.store'], storeId);
    const productName = requiredString(input.name, 'name');
    const sku = requiredString(input.sku, 'sku').toUpperCase();
    const amountCents = money(input.amountCents, 'amountCents');
    const costCents = input.costCents === undefined ? 0 : money(input.costCents, 'costCents');
    const includesTax = input.includesTax === true;
    const openingQuantity = input.openingQuantity === undefined || input.openingQuantity === null ? 0 : finiteNumber(input.openingQuantity, 'openingQuantity');
    if (openingQuantity < 0) throw new BadRequestException('Opening quantity cannot be negative');
    const taxGroupId = typeof input.taxGroupId === 'string' ? uuid(input.taxGroupId, 'taxGroupId') : null;
    if (taxGroupId) await this.assertTaxGroupUsable(context.organizationId, storeId, taxGroupId);
    const categoryId = typeof input.categoryId === 'string' ? uuid(input.categoryId, 'categoryId') : null;
    if (categoryId && !(await this.prisma.category.findFirst({ where: { id: categoryId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new BadRequestException('Category not found');
    }
    const brandId = typeof input.brandId === 'string' ? uuid(input.brandId, 'brandId') : null;
    let brandName = optionalString(input.brand) ?? '';
    if (brandId) {
      const brand = await this.prisma.brand.findFirst({ where: { id: brandId, organizationId: context.organizationId }, select: { name: true } });
      if (!brand) throw new BadRequestException('Brand not found');
      brandName = brand.name;
    }
    const variantName = optionalString(input.variantName) || 'Standard';
    const barcode = optionalString(input.barcode);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            organizationId: context.organizationId,
            categoryId,
            brandId,
            name: productName,
            brand: brandName,
            status: 'ACTIVE',
          },
        });
        const variant = await tx.productVariant.create({
          data: { organizationId: context.organizationId, productId: product.id, sku, name: variantName, costCents, taxGroupId },
        });
        if (barcode) await tx.barcode.create({ data: { organizationId: context.organizationId, variantId: variant.id, code: barcode } });
        // A price entered by a store for a new product is the organisation base price (not a store-only price).
        await tx.variantPrice.create({ data: { organizationId: context.organizationId, variantId: variant.id, storeId: null, amountCents, includesTax } });
        await tx.storeVariant.create({ data: { organizationId: context.organizationId, storeId, variantId: variant.id, status: 'ACTIVE', sourceType: 'STORE_CREATED', verifiedAt: new Date(), verifiedByUserId: context.userId } });
        if (openingQuantity > 0) {
          const location = await this.storeLocation(tx, context.organizationId, storeId);
          if (!location) throw new BadRequestException('This store has no stock location. Create one on Inventory first.');
          await this.postInventory(tx, context, location.id, variant.id, openingQuantity, 'RECEIPT', null, 'Opening stock', costCents, 'SELLABLE');
        }
        await this.audit.record(context, 'store-product.created', 'ProductVariant', variant.id, { storeId, sku }, tx);
        return { productId: product.id, variantId: variant.id };
      });
      return result;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('SKU or barcode already exists in the organisation');
      throw error;
    }
  }

  // ───────────── Distribution: organisation pushes products to a store with suggested price/tax ─────────────

  async listDistributions(context: UserContext) {
    this.requireOrganizationPermission(context, 'catalog.distribute');
    const distributions = await this.prisma.distribution.findMany({
      where: { organizationId: context.organizationId },
      include: { toStore: { select: { name: true, code: true } }, lines: { include: { variant: { select: { sku: true, name: true, product: { select: { name: true } } } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return distributions.map((d) => this.distributionDto(d));
  }

  async listPendingForStore(context: UserContext, requestedStoreId: string) {
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['store-catalog.verify'], storeId);
    const pending = await this.prisma.storeVariant.findMany({
      where: { storeId, status: 'PENDING_VERIFICATION' },
      include: { taxGroup: { select: { id: true, name: true, rateBps: true } }, variant: { include: { product: { select: { name: true, brand: true, category: { select: { name: true } } } }, prices: this.currentPriceFilter(storeId), taxGroup: { select: { id: true, name: true, rateBps: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    const location = await this.storeLocation(this.prisma, context.organizationId, storeId);
    const balances = location ? await this.prisma.inventoryBalance.findMany({ where: { locationId: location.id, status: 'QUARANTINE', variantId: { in: pending.map((p) => p.variantId) } } }) : [];
    const byVariant = new Map(balances.map((b) => [b.variantId, Number(b.quantity)]));
    return pending.map((p) => ({
      variantId: p.variantId,
      sku: p.variant.sku,
      name: `${p.variant.product.name} ${p.variant.name}`.trim(),
      brand: p.variant.product.brand,
      category: p.variant.product.category?.name ?? '',
      suggestedPriceCents: this.pickPrice(p.variant.prices, storeId)?.amountCents ?? 0,
      taxGroup: p.taxGroup ?? p.variant.taxGroup,
      pendingQuantity: byVariant.get(p.variantId) ?? 0,
    }));
  }

  async createDistribution(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'catalog.distribute');
    const toStoreId = uuid(input.toStoreId, 'toStoreId');
    const store = await this.prisma.store.findFirst({ where: { id: toStoreId, organizationId: context.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!store) throw new NotFoundException('Destination store not found');
    const lines = Array.isArray(input.lines) ? input.lines as JsonObject[] : [];
    if (!lines.length) throw new BadRequestException('Distribution needs at least one line');
    if (lines.length > 500) throw new BadRequestException('At most 500 lines per distribution');
    const parsed = lines.map((line) => {
      const quantity = finiteNumber(line.quantity, 'quantity');
      if (quantity < 0) throw new BadRequestException('Line quantity cannot be negative');
      const suggestedPriceCents = line.suggestedPriceCents === undefined || line.suggestedPriceCents === null ? null : money(line.suggestedPriceCents, 'suggestedPriceCents');
      const suggestedTaxGroupId = typeof line.suggestedTaxGroupId === 'string' ? uuid(line.suggestedTaxGroupId, 'suggestedTaxGroupId') : null;
      return { variantId: uuid(line.variantId, 'variantId'), quantity, suggestedPriceCents, suggestedTaxGroupId };
    });
    await this.assertVariantsInOrganization(context.organizationId, parsed.map((l) => l.variantId));
    const distribution = await this.prisma.$transaction(async (tx) => {
      const created = await tx.distribution.create({
        data: {
          organizationId: context.organizationId,
          toStoreId,
          createdByUserId: context.userId,
          notes: optionalString(input.notes) ?? '',
          status: 'DRAFT',
          lines: { create: parsed },
        },
      });
      await this.audit.record(context, 'distribution.created', 'Distribution', created.id, { toStoreId, lineCount: parsed.length }, tx);
      return created;
    });
    // `dispatch: true` sends it straight away: the store sees the items as Pending and chooses when to add them.
    if (input.dispatch === true) return this.dispatchDistribution(context, distribution.id);
    return { id: distribution.id, status: distribution.status };
  }

  async dispatchDistribution(context: UserContext, distributionId: string) {
    this.requireOrganizationPermission(context, 'catalog.distribute');
    const id = uuid(distributionId, 'distributionId');
    const d = await this.prisma.distribution.findFirst({ where: { id, organizationId: context.organizationId }, include: { lines: true } });
    if (!d) throw new NotFoundException('Distribution not found');
    if (d.status !== 'DRAFT') throw new ConflictException(`A ${d.status} distribution cannot be dispatched`);
    await this.prisma.$transaction(async (tx) => {
      const location = await this.storeLocation(tx, context.organizationId, d.toStoreId);
      if (!location) throw new BadRequestException('Destination store has no stock location');
      for (const line of d.lines) {
        // Place as PENDING in the store catalogue and park stock as QUARANTINE.
        await tx.storeVariant.upsert({
          where: { storeId_variantId: { storeId: d.toStoreId, variantId: line.variantId } },
          create: { organizationId: context.organizationId, storeId: d.toStoreId, variantId: line.variantId, status: 'PENDING_VERIFICATION', sourceType: 'ORG_DISTRIBUTION' },
          update: { status: 'PENDING_VERIFICATION' },
        });
        // The base price is organisation-wide; a distribution never creates a store-only price.
        if (line.suggestedTaxGroupId) {
          await tx.storeVariant.update({ where: { storeId_variantId: { storeId: d.toStoreId, variantId: line.variantId } }, data: { taxGroupId: line.suggestedTaxGroupId } });
        }
        if (Number(line.quantity) > 0) await this.postInventory(tx, context, location.id, line.variantId, Number(line.quantity), 'TRANSFER_IN', d.id, 'Distribution dispatched', 0, 'QUARANTINE');
      }
      await tx.distribution.update({ where: { id: d.id }, data: { status: 'DISPATCHED' } });
      await this.audit.record(context, 'distribution.dispatched', 'Distribution', d.id, {}, tx);
    });
    return { id: d.id, status: 'DISPATCHED' };
  }

  async verifyPendingItem(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['store-catalog.verify'], storeId);
    const variantId = uuid(input.variantId, 'variantId');
    const action = oneOf(input.action, ['ACCEPT', 'REJECT'] as const, 'action');
    if (input.priceCents !== undefined && input.priceCents !== null) throw new BadRequestException('The base price is set by the organisation and cannot be changed for one store');
    const taxGroupId = input.taxGroupId === undefined ? undefined : input.taxGroupId === null ? null : uuid(input.taxGroupId, 'taxGroupId');
    if (taxGroupId) await this.assertTaxGroupUsable(context.organizationId, storeId, taxGroupId);
    const sv = await this.prisma.storeVariant.findUnique({ where: { storeId_variantId: { storeId, variantId } } });
    if (!sv || sv.status !== 'PENDING_VERIFICATION') throw new NotFoundException('No pending item for this product in this store');
    await this.prisma.$transaction(async (tx) => {
      const location = await this.storeLocation(tx, context.organizationId, storeId);
      if (!location) throw new BadRequestException('Store has no stock location');
      const quarantined = await tx.inventoryBalance.findUnique({ where: { locationId_variantId_status: { locationId: location.id, variantId, status: 'QUARANTINE' } } });
      const qty = Number(quarantined?.quantity ?? 0);
      if (action === 'ACCEPT') {
        if (qty > 0) {
          await this.postInventory(tx, context, location.id, variantId, -qty, 'ADJUSTMENT', sv.id, 'Verified: release from quarantine', 0, 'QUARANTINE');
          await this.postInventory(tx, context, location.id, variantId, qty, 'RECEIPT', sv.id, 'Verified: accepted into store', 0, 'SELLABLE');
        }
        await tx.storeVariant.update({
          where: { id: sv.id },
          data: { status: 'ACTIVE', verifiedAt: new Date(), verifiedByUserId: context.userId, ...(taxGroupId !== undefined ? { taxGroupId } : {}) },
        });
        await this.audit.record(context, 'store-variant.verified', 'StoreVariant', sv.id, { taxGroupId }, tx);
      } else {
        if (qty > 0) {
          await this.postInventory(tx, context, location.id, variantId, -qty, 'ADJUSTMENT', sv.id, 'Verified: rejected, removed from quarantine', 0, 'QUARANTINE');
        }
        await tx.storeVariant.update({ where: { id: sv.id }, data: { status: 'DISABLED', verifiedAt: new Date(), verifiedByUserId: context.userId } });
        await this.audit.record(context, 'store-variant.rejected', 'StoreVariant', sv.id, {}, tx);
      }
    });
    return { storeId, variantId, action };
  }

  private distributionDto(d: Prisma.DistributionGetPayload<{ include: { toStore: { select: { name: true; code: true } }; lines: { include: { variant: { select: { sku: true; name: true; product: { select: { name: true } } } } } } } }>) {
    return {
      id: d.id,
      status: d.status,
      toStoreId: d.toStoreId,
      toStoreName: d.toStore.name,
      toStoreCode: d.toStore.code,
      notes: d.notes,
      createdAt: d.createdAt,
      lines: d.lines.map((line) => ({
        variantId: line.variantId,
        sku: line.variant.sku,
        name: `${line.variant.product.name} ${line.variant.name}`.trim(),
        quantity: Number(line.quantity),
        acceptedQuantity: Number(line.acceptedQuantity),
        rejectedQuantity: Number(line.rejectedQuantity),
        suggestedPriceCents: line.suggestedPriceCents,
        suggestedTaxGroupId: line.suggestedTaxGroupId,
      })),
    };
  }

  // ───────────── Register sessions & cash ─────────────

  async listSessions(context: UserContext, storeId?: string) {
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store) {
      this.authorization.assertStoreAccess(context, store);
      this.authorization.assertPermissions(context, ['registers.view'], store);
    }
    const permitted = store ? [store] : await this.authorization.permittedStoreIds(context, 'registers.view');
    const sessions = await this.prisma.registerSession.findMany({
      where: { organizationId: context.organizationId, ...(permitted ? { storeId: { in: permitted } } : {}) },
      include: SESSION_INCLUDE,
      orderBy: { openedAt: 'desc' },
    });
    return sessions.map((session) => this.sessionDto(session));
  }

  async openSession(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId ?? context.defaultStoreId, 'storeId');
    const registerId = uuid(input.registerId, 'registerId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['register.open'], storeId);
    const register = await this.prisma.register.findFirst({
      where: { id: registerId, organizationId: context.organizationId, status: 'ACTIVE' },
    });
    if (!register || register.storeId !== storeId) throw new NotFoundException('Active register not found in store');
    const openingFloatCents = money(input.openingFloatCents ?? 0, 'openingFloatCents');

    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const created = await tx.registerSession.create({
          data: {
            organizationId: context.organizationId,
            storeId,
            registerId,
            openedById: context.userId,
            openingFloatCents,
            expectedCashCents: openingFloatCents,
          },
          include: SESSION_INCLUDE,
        });
        await this.audit.record(context, 'register-session.opened', 'RegisterSession', created.id, { storeId, registerId, openingFloatCents }, tx);
        return created;
      });
      return this.sessionDto(session);
    } catch (error) {
      // The partial unique index allows only one OPEN session per register.
      if (isUniqueViolation(error)) throw new ConflictException('This register already has an open session');
      throw error;
    }
  }

  async cashMovement(context: UserContext, sessionId: string, input: JsonObject) {
    const session = await this.openSessionRow(context, sessionId);
    this.authorization.assertPermissions(context, ['cash.manage'], session.storeId);
    const type = oneOf(input.type, CASH_MOVEMENTS, 'type');
    const amountCents = money(input.amountCents);
    const signed = OUTFLOW_MOVEMENTS.includes(type) ? -amountCents : amountCents;
    await this.prisma.$transaction(async (tx) => {
      await tx.cashMovement.create({
        data: { organizationId: context.organizationId, sessionId, type, amountCents: signed, reason: optionalString(input.reason) ?? '', actorUserId: context.userId },
      });
      await tx.registerSession.update({ where: { id: sessionId }, data: { expectedCashCents: { increment: signed } } });
      await this.audit.record(context, 'cash-movement.recorded', 'RegisterSession', sessionId, { type, amountCents: signed }, tx);
    });
    return this.sessionById(context, session.id);
  }

  async closeSession(context: UserContext, sessionId: string, input: JsonObject) {
    const denominationCount = this.denominationCount(input.denominations);
    const counted = denominationCount
      ? denominationCount.totalCents
      : money(input.countedCashCents, 'countedCashCents');
    const closed = await this.prisma.$transaction(async (tx) => {
      const session = await this.openSessionRow(context, sessionId, tx);
      this.authorization.assertPermissions(context, ['register.close'], session.storeId);
      const variance = counted - session.expectedCashCents;
      // `status: OPEN` in the filter makes a concurrent double-close a no-op instead of a second close.
      const result = await tx.registerSession.updateMany({
        where: { id: sessionId, status: 'OPEN' },
        data: { status: 'CLOSED', countedCashCents: counted, varianceCents: variance, closedAt: new Date() },
      });
      if (result.count === 0) throw new ConflictException('Register session is already closed');
      if (variance !== 0) {
        await this.raiseAlert(tx, context, 'CASH_VARIANCE', variance < 0 ? 'HIGH' : 'MEDIUM', `Register variance is ${formatRupees(variance)}`, sessionId, session.storeId);
      }
      await this.audit.record(context, 'register-session.closed', 'RegisterSession', sessionId, { counted, expected: session.expectedCashCents, variance, denominations: denominationCount?.items ?? null }, tx);
      return session.id;
    });
    return { ...(await this.sessionById(context, closed)), countedByDenomination: denominationCount?.items ?? null };
  }

  async sessionSummary(context: UserContext, sessionId: string) {
    const session = await this.findSession(context, sessionId);
    this.authorization.assertPermissions(context, ['registers.view'], session.storeId);
    const [sales, payments, movements] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { sessionId, status: 'COMPLETED' },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      this.prisma.salePayment.groupBy({
        by: ['tenderType'],
        where: { sale: { sessionId, status: 'COMPLETED' } },
        _sum: { amountCents: true },
      }),
      this.prisma.cashMovement.findMany({ where: { sessionId }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      session: await this.sessionById(context, session.id),
      sales: { count: sales._count._all, totalCents: sales._sum.totalCents ?? 0 },
      payments: payments.map((payment) => ({ tenderType: payment.tenderType, amountCents: payment._sum.amountCents ?? 0 })),
      movements: movements.map((movement) => ({
        type: movement.type,
        amountCents: movement.amountCents,
        reason: movement.reason,
        createdAt: movement.createdAt,
      })),
    };
  }

  // ───────────── Hold / resume ─────────────

  async holdSale(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId ?? context.defaultStoreId, 'storeId');
    const registerId = uuid(input.registerId, 'registerId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['sale.hold'], storeId);
    const register = await this.prisma.register.findFirst({ where: { id: registerId, storeId, organizationId: context.organizationId }, select: { id: true } });
    if (!register) throw new NotFoundException('Register not found in store');
    const clientHoldId = optionalString(input.clientHoldId) || undefined;
    try {
      const held = await this.prisma.heldSale.create({
        data: {
          organizationId: context.organizationId,
          storeId,
          registerId,
          clientHoldId: clientHoldId ?? randomUUID(),
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          createdById: context.userId,
        },
      });
      return { id: held.id, clientHoldId: held.clientHoldId, payload: held.payload, createdAt: held.createdAt };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A held sale with this clientHoldId already exists');
      throw error;
    }
  }

  async listHeldSales(context: UserContext, storeId?: string) {
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store) {
      this.authorization.assertStoreAccess(context, store);
      this.authorization.assertPermissions(context, ['sale.hold'], store);
    }
    const permitted = store ? [store] : await this.authorization.permittedStoreIds(context, 'sale.hold');
    const holds = await this.prisma.heldSale.findMany({
      where: { organizationId: context.organizationId, ...(permitted ? { storeId: { in: permitted } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return holds.map((held) => ({ id: held.id, clientHoldId: held.clientHoldId, registerId: held.registerId, payload: held.payload, createdAt: held.createdAt }));
  }

  async resumeHold(context: UserContext, holdId: string) {
    const held = await this.prisma.heldSale.findFirst({ where: { id: uuid(holdId, 'holdId'), organizationId: context.organizationId } });
    if (!held) throw new NotFoundException('Held sale not found');
    this.authorization.assertStoreAccess(context, held.storeId);
    this.authorization.assertPermissions(context, ['sale.hold'], held.storeId);
    // Deleting by id is the claim: only one concurrent resume can succeed.
    const deleted = await this.prisma.heldSale.deleteMany({ where: { id: held.id } });
    if (deleted.count === 0) throw new ConflictException('Held sale was already resumed');
    return { id: held.id, payload: held.payload };
  }

  // ───────────── Checkout ─────────────

  async completeSale(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId ?? context.defaultStoreId, 'storeId');
    const registerId = uuid(input.registerId, 'registerId');
    const sessionId = uuid(input.sessionId, 'sessionId');
    const clientSaleId = optionalString(input.clientSaleId) || randomUUID();
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['sale.create'], storeId);

    // A retried checkout returns the original sale.
    const existing = await this.findSaleByClientId(context.organizationId, clientSaleId);
    if (existing) return this.saleResult(existing);

    const session = await this.openSessionRow(context, sessionId);
    if (session.storeId !== storeId || session.registerId !== registerId) {
      throw new BadRequestException('Session does not belong to this register and store');
    }
    const rawLines = Array.isArray(input.lines) ? input.lines as LineInput[] : [];
    if (!rawLines.length) throw new BadRequestException('At least one sale line is required');
    const lines = await Promise.all(rawLines.map((line) => this.priceLine(context, line, storeId)));

    const orderDiscount = money(input.discountCents ?? 0, 'discountCents');
    const subtotal = lines.reduce((sum, line) => sum + line.netCents, 0);
    const lineDiscount = lines.reduce((sum, line) => sum + line.discountCents, 0);
    const requestedDiscount = lineDiscount + orderDiscount;
    const discountReason = optionalString(input.discountReason) ?? lines.find((line) => line.discountReason)?.discountReason ?? '';
    const managerApprovalUserId = await this.assertDiscountAllowed(context, storeId, requestedDiscount, subtotal + lineDiscount, input.approvalId, input.managerPin);
    if (requestedDiscount > 0 && !discountReason) throw new BadRequestException('discountReason is required when a discount is applied');

    const discount = Math.min(orderDiscount, subtotal);
    const lineTax = lines.reduce((sum, line) => sum + line.taxCents, 0);
    const itemTax = Math.max(0, lineTax - Math.round((discount * lineTax) / Math.max(1, subtotal)));
    const chargePlan = await this.computeCharges(context.organizationId, storeId, lines, subtotal - discount);
    const tax = itemTax + chargePlan.taxCents;
    const total = subtotal - discount + tax + chargePlan.netCents;

    const paymentPlan = await this.paymentPlan(context.organizationId, input.payments, total);
    if (paymentPlan.appliedTotalCents !== paymentPlan.roundedTotalCents) throw new BadRequestException(`Payment total must equal ${formatRupees(paymentPlan.roundedTotalCents)}`);

    const customerId = typeof input.customerId === 'string' ? uuid(input.customerId, 'customerId') : null;
    if (customerId && !(await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new BadRequestException('Customer not found');
    }

    try {
      const saleId = await this.prisma.$transaction(async (tx) => {
        const location = await this.storeLocation(tx, context.organizationId, storeId);
        if (location) {
          const policy = await this.negativeStockPolicy(tx, context.organizationId, storeId);
          for (const line of lines) {
            const balance = await tx.inventoryBalance.findUnique({ where: { locationId_variantId_status: { locationId: location.id, variantId: line.variantId, status: 'SELLABLE' } }, select: { quantity: true } });
            const available = balance ? num(balance.quantity) : 0;
            if (available - line.quantity < 0) {
              if (policy === 'BLOCK') throw new BadRequestException(`Insufficient stock for ${line.sku}`);
              if (policy === 'WARN') await this.raiseAlert(tx, context, 'NEGATIVE_STOCK', 'HIGH', `Sale would make ${line.sku} negative (${formatRupees(Math.round((available - line.quantity) * 100))})`, clientSaleId, storeId);
            }
          }
        }
        const receiptNumber = await this.nextDocumentNumber(tx, context.organizationId, storeId, 'TAX');
        const sale = await tx.sale.create({
          data: {
            organizationId: context.organizationId,
            storeId,
            registerId,
            sessionId,
            clientSaleId,
            receiptNumber,
            subtotalCents: subtotal,
            discountCents: lineDiscount + discount,
            taxCents: tax,
            chargeCents: chargePlan.netCents,
            charges: chargePlan.items as unknown as Prisma.InputJsonValue,
            roundingCents: paymentPlan.roundingCents,
            totalCents: total,
            notes: [optionalString(input.notes), discountReason ? `Discount reason: ${discountReason}` : undefined].filter(Boolean).join(' | '),
            customerId,
            createdById: context.userId,
            lines: {
              create: lines.map((line) => ({
                variantId: line.variantId,
                sku: line.sku,
                name: line.name,
                quantity: line.quantity,
                unitPriceCents: line.unitPriceCents,
                unitCostCents: line.unitCostCents,
                discountCents: line.discountCents,
                taxRateBps: line.taxRateBps,
                hsnCode: line.hsnCode,
                taxCents: line.taxCents,
                lineTotalCents: line.lineTotalCents,
                note: line.note,
              })),
            },
            payments: { create: paymentPlan.payments },
          },
        });

        const cashReceived = paymentPlan.payments.filter((payment) => payment.tenderType === 'CASH').reduce((sum, payment) => sum + payment.amountCents, 0);
        if (cashReceived > 0) {
          await tx.registerSession.update({ where: { id: sessionId }, data: { expectedCashCents: { increment: cashReceived } } });
        }
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: 'sale.completed',
            aggregateId: sale.id,
            payload: { saleId: sale.id, storeId, lines } as unknown as Prisma.InputJsonValue,
          },
        });
        if (location) {
          for (const line of lines) {
            await this.postInventory(tx, context, location.id, line.variantId, -line.quantity, 'SALE', sale.id, 'Sale completed', 0, 'SELLABLE');
          }
        }
        if (customerId) await this.earnPoints(tx, customerId, total, sale.id);
        if (managerApprovalUserId) {
          await tx.approval.create({ data: {
            organizationId: context.organizationId,
            action: 'SALE_DISCOUNT',
            referenceId: sale.id,
            requestedById: context.userId,
            approvedById: managerApprovalUserId,
            reason: discountReason || 'Manager PIN approval',
            status: 'APPROVED',
            decidedAt: new Date(),
          } });
        }
        await this.audit.record(context, 'sale.completed', 'Sale', sale.id, { receiptNumber, total, clientSaleId, managerApprovalUserId }, tx);
        return sale.id;
      });
      return this.saleResult(await this.findSaleOrThrow(context.organizationId, saleId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent request with the same clientSaleId won the race.
        const winner = await this.findSaleByClientId(context.organizationId, clientSaleId);
        if (winner) return this.saleResult(winner);
      }
      throw error;
    }
  }

  async listSales(context: UserContext, storeId?: string, from?: string, to?: string, receipt?: string, customer?: string) {
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store) {
      this.authorization.assertStoreAccess(context, store);
      this.authorization.assertPermissions(context, ['sale.create'], store);
    }
    const reachable = store ? [store] : await this.authorization.permittedStoreIds(context, 'sale.create');
    const where = {
      organizationId: context.organizationId,
      ...(reachable ? { storeId: { in: reachable } } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: this.dayBoundary(from, 'from', false) } : {}), ...(to ? { lte: this.dayBoundary(to, 'to', true) } : {}) } } : {}),
      ...(receipt || customer ? { OR: [
        ...(receipt ? [{ receiptNumber: { contains: receipt.trim(), mode: 'insensitive' as const } }] : []),
        ...(customer ? [{ customer: { OR: [{ name: { contains: customer.trim(), mode: 'insensitive' as const } }, { phone: { contains: customer.trim(), mode: 'insensitive' as const } }] } }] : []),
      ] } : {}),
    };
    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        register: { select: { code: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        payments: { select: { tenderType: true, amountCents: true } },
        _count: { select: { lines: true, returns: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return sales.map((sale) => ({
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      storeId: sale.storeId,
      registerId: sale.registerId,
      sessionId: sale.sessionId,
      status: sale.status,
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      roundingCents: sale.roundingCents,
      taxCents: sale.taxCents,
      chargeCents: sale.chargeCents,
      charges: Array.isArray(sale.charges) ? sale.charges : [],
      totalCents: sale.totalCents,
      createdAt: sale.createdAt,
      cashier: `${sale.createdBy.firstName} ${sale.createdBy.lastName}`.trim(),
      register: sale.register.name || sale.register.code,
      itemCount: sale._count.lines,
      tender: [...new Set(sale.payments.map((payment) => payment.tenderType))].join(' + '),
      returnCount: sale._count.returns,
    }));
  }

  async getSale(context: UserContext, saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: uuid(saleId, 'saleId'), organizationId: context.organizationId },
      include: {
        lines: true,
        payments: true,
        returns: { include: { lines: true } },
        register: { select: { code: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    this.authorization.assertStoreAccess(context, sale.storeId);
    this.authorization.assertPermissions(context, ['sale.create'], sale.storeId);
    const settingsRow = await this.prisma.organizationSettings.findUnique({ where: { organizationId: context.organizationId }, select: { settings: true } });
    const receiptFooter = (settingsRow?.settings as JsonObject | null)?.receiptFooter;
    return {
      receiptFooter: typeof receiptFooter === 'string' ? receiptFooter : '',
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      storeId: sale.storeId,
      registerId: sale.registerId,
      sessionId: sale.sessionId,
      status: sale.status,
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      roundingCents: sale.roundingCents,
      taxCents: sale.taxCents,
      totalCents: sale.totalCents,
      createdAt: sale.createdAt,
      cashier: `${sale.createdBy.firstName} ${sale.createdBy.lastName}`.trim(),
      register: sale.register.name || sale.register.code,
      lines: sale.lines.map((line) => ({ ...line, quantity: num(line.quantity) })),
      payments: sale.payments,
      returns: sale.returns.map((value) => ({ id: value.id, creditNoteNumber: value.creditNoteNumber, totalCents: value.totalCents, createdAt: value.createdAt, reason: value.reason })),
    };
  }

  /** GST tax invoice for a sale as a PDF. */
  async invoicePdf(context: UserContext, saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: uuid(saleId, 'saleId'), organizationId: context.organizationId },
      include: {
        lines: true,
        payments: true,
        customer: { select: { name: true, phone: true } },
        register: { select: { code: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        store: { select: { name: true, code: true, address: true, timezone: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    this.authorization.assertStoreAccess(context, sale.storeId);
    this.authorization.assertPermissions(context, ['sale.create'], sale.storeId);
    const [organization, settingsRow] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: context.organizationId }, select: { name: true, legalName: true, tradeName: true, address: true, gstin: true } }),
      this.prisma.organizationSettings.findUnique({ where: { organizationId: context.organizationId }, select: { settings: true } }),
    ]);
    const footer = (settingsRow?.settings as JsonObject | null)?.receiptFooter;
    const charges = (Array.isArray(sale.charges) ? sale.charges : []) as { name: string; amountCents: number; taxCents: number; taxRateBps: number }[];
    const buffer = buildInvoicePdf({
      invoiceNumber: sale.receiptNumber,
      issuedAt: sale.createdAt,
      timezone: sale.store.timezone,
      status: sale.status,
      seller: { name: organization?.legalName || organization?.tradeName || organization?.name || 'Invoice', address: organization?.address ?? '', gstin: organization?.gstin ?? '', storeName: sale.store.name, storeCode: sale.store.code, storeAddress: sale.store.address },
      customer: sale.customer ? { name: sale.customer.name, phone: sale.customer.phone ?? '' } : null,
      cashier: `${sale.createdBy.firstName} ${sale.createdBy.lastName}`.trim(),
      register: sale.register.name || sale.register.code,
      lines: sale.lines.map((line) => ({ name: line.name, sku: line.sku, hsnCode: line.hsnCode, quantity: num(line.quantity), unitPriceCents: line.unitPriceCents, discountCents: line.discountCents, taxRateBps: line.taxRateBps, taxCents: line.taxCents - 0, lineTotalCents: line.lineTotalCents })),
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      charges,
      taxCents: sale.taxCents,
      roundingCents: sale.roundingCents,
      totalCents: sale.totalCents,
      payments: sale.payments.map((payment) => ({ tenderType: payment.tenderType, amountCents: payment.amountCents, reference: payment.reference })),
      footer: typeof footer === 'string' ? footer : '',
    });
    return { filename: `${sale.receiptNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`, buffer };
  }

  // ───────────── Approvals ─────────────

  async requestApproval(context: UserContext, input: JsonObject) {
    const referenceId = requiredString(input.referenceId, 'referenceId');
    if (!context.isOrganisationAdministrator) {
      const storeId = uuid(input.storeId, 'storeId');
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['approval.manage'], storeId);
      const inStore = await this.prisma.sale.findFirst({ where: { id: referenceId, organizationId: context.organizationId, storeId }, select: { id: true } })
        ?? await this.prisma.saleReturn.findFirst({ where: { id: referenceId, organizationId: context.organizationId, storeId }, select: { id: true } });
      if (!inStore) throw new NotFoundException('Approval reference not found for this store');
    }
    const approval = await this.prisma.approval.create({
      data: {
        organizationId: context.organizationId,
        action: requiredString(input.action, 'action').toUpperCase(),
        referenceId,
        requestedById: context.userId,
        reason: requiredString(input.reason ?? 'Manager approval requested', 'reason'),
      },
    });
    return { id: approval.id, action: approval.action, referenceId: approval.referenceId, status: approval.status, reason: approval.reason, createdAt: approval.createdAt };
  }

  async decideApproval(context: UserContext, approvalId: string, input: JsonObject) {
    const status = oneOf(input.status, ['APPROVED', 'DENIED'] as const, 'status');
    const approval = await this.prisma.approval.findFirst({ where: { id: uuid(approvalId, 'approvalId'), organizationId: context.organizationId } });
    if (!approval) throw new NotFoundException('Approval not found');
    if (!context.isOrganisationAdministrator) await this.assertApprovalStoreAccess(context, approval.referenceId);
    const decided = await this.prisma.approval.updateMany({
      where: { id: approval.id, status: 'PENDING' },
      data: { status, approvedById: context.userId, decidedAt: new Date() },
    });
    if (decided.count === 0) throw new ConflictException('Approval has already been decided');
    await this.audit.record(context, `approval.${status.toLowerCase()}`, 'Approval', approval.id, { action: approval.action, referenceId: approval.referenceId });
    const result = await this.prisma.approval.findUniqueOrThrow({ where: { id: approval.id } });
    return {
      id: result.id,
      action: result.action,
      referenceId: result.referenceId,
      status: result.status,
      reason: result.reason,
      approvedBy: result.approvedById,
      decidedAt: result.decidedAt,
    };
  }

  async listApprovals(context: UserContext, storeId?: string) {
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store) {
      this.authorization.assertStoreAccess(context, store);
      this.authorization.assertPermissions(context, ['approval.manage'], store);
    }
    const scopedStores = store ? [store] : await this.authorization.permittedStoreIds(context, 'approval.manage');
    const candidates = await this.prisma.approval.findMany({
      where: { organizationId: context.organizationId },
      include: { requestedBy: { select: { firstName: true, lastName: true } }, approvedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    let approvals = candidates;
    if (scopedStores) {
      const references = [...new Set(candidates.map((approval) => approval.referenceId))];
      if (references.length) {
        const [sales, returns] = await Promise.all([
          this.prisma.sale.findMany({ where: { organizationId: context.organizationId, id: { in: references }, storeId: { in: scopedStores } }, select: { id: true } }),
          this.prisma.saleReturn.findMany({ where: { organizationId: context.organizationId, id: { in: references }, storeId: { in: scopedStores } }, select: { id: true } }),
        ]);
        const allowedReferences = new Set([...sales.map((row) => row.id), ...returns.map((row) => row.id)]);
        approvals = candidates.filter((approval) => allowedReferences.has(approval.referenceId));
      } else approvals = [];
    }
    return approvals.map((approval) => ({
      id: approval.id,
      action: approval.action,
      referenceId: approval.referenceId,
      status: approval.status,
      reason: approval.reason,
      requestedBy: `${approval.requestedBy.firstName} ${approval.requestedBy.lastName}`.trim(),
      approvedBy: approval.approvedBy ? `${approval.approvedBy.firstName} ${approval.approvedBy.lastName}`.trim() : null,
      createdAt: approval.createdAt,
      decidedAt: approval.decidedAt,
    }));
  }

  // ───────────── Inventory ─────────────

  async inventory(context: UserContext, storeId?: string) {
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['inventory.view'], storeId);
    }
    const accessible = storeId ? [storeId] : await this.authorization.permittedStoreIds(context, 'inventory.view');
    const locationFilter = accessible ? { location: { storeId: { in: accessible } } } : {};
    const [balances, movements] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where: { organizationId: context.organizationId, ...locationFilter },
        include: { location: { select: { name: true } }, variant: { select: { sku: true, name: true } } },
        orderBy: { variant: { name: 'asc' } },
      }),
      this.prisma.inventoryMovement.findMany({
        where: { organizationId: context.organizationId, ...locationFilter },
        include: { variant: { select: { sku: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return {
      balances: balances.map((balance) => ({
        locationId: balance.locationId,
        locationName: balance.location.name,
        variantId: balance.variantId,
        sku: balance.variant.sku,
        name: balance.variant.name,
        status: balance.status,
        quantity: num(balance.quantity),
        reorderPoint: num(balance.reorderPoint),
        safetyStock: num(balance.safetyStock),
        updatedAt: balance.updatedAt,
      })),
      movements: movements.map((movement) => ({
        id: movement.id,
        locationId: movement.locationId,
        variantId: movement.variantId,
        sku: movement.variant.sku,
        name: movement.variant.name,
        quantity: num(movement.quantity),
        status: movement.status,
        type: movement.type,
        reason: movement.reason,
        referenceId: movement.referenceId,
        createdAt: movement.createdAt,
      })),
    };
  }

  async ledger(context: UserContext, storeId?: string) {
    const result = await this.inventory(context, storeId);
    return result.movements;
  }

  async listLocations(context: UserContext, storeId?: string) {
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['inventory.view'], storeId);
    }
    const accessible = storeId ? [storeId] : await this.authorization.permittedStoreIds(context, 'inventory.view');
    const locations = await this.prisma.stockLocation.findMany({
      where: { organizationId: context.organizationId, ...(accessible ? { storeId: { in: accessible } } : {}) },
      orderBy: { name: 'asc' },
    });
    return locations.map((location) => this.locationDto(location));
  }

  async createLocation(context: UserContext, input: JsonObject) {
    const storeId = typeof input.storeId === 'string' && input.storeId.trim() ? uuid(input.storeId, 'storeId') : null;
    if (storeId && !(await this.prisma.store.findFirst({ where: { id: storeId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new NotFoundException('Store not found');
    }
    if (storeId) this.authorization.assertStoreAccess(context, storeId);
    else if (!context.isOrganisationAdministrator) throw new ForbiddenException('A store must be selected');
    if (storeId) this.authorization.assertPermissions(context, ['inventory.manage'], storeId);
    try {
      const location = await this.prisma.$transaction(async (tx) => {
        const created = await tx.stockLocation.create({
          data: { organizationId: context.organizationId, storeId, code: requiredString(input.code, 'code').toUpperCase(), name: requiredString(input.name, 'name') },
        });
        await this.audit.record(context, 'stock-location.created', 'StockLocation', created.id, { code: created.code }, tx);
        return created;
      });
      return this.locationDto(location);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A stock location with this code already exists');
      throw error;
    }
  }

  async adjustInventory(context: UserContext, input: JsonObject) {
    const locationId = uuid(input.locationId, 'locationId');
    const variantId = uuid(input.variantId, 'variantId');
    const quantity = finiteNumber(input.quantity, 'quantity');
    const status = input.status === undefined ? 'SELLABLE' : oneOf(input.status, INVENTORY_STATUSES, 'status');
    const reason = requiredString(input.reason ?? 'Manual adjustment', 'reason');
    const unitCostCents = money(input.unitCostCents ?? 0, 'unitCostCents');

    const location = await this.prisma.stockLocation.findFirst({ where: { id: locationId, organizationId: context.organizationId } });
    if (!location) throw new NotFoundException('Stock location not found');
    if (location.storeId) this.authorization.assertStoreAccess(context, location.storeId);
    else if (!context.isOrganisationAdministrator) throw new ForbiddenException('Organisation stock locations require organisation access');
    if (location.storeId) this.authorization.assertPermissions(context, ['inventory.manage'], location.storeId);
    if (!(await this.prisma.productVariant.findFirst({ where: { id: variantId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new NotFoundException('Product variant not found');
    }
    // Receiving stock adds a product to the store's catalogue; removing stock of a product the store does not sell is an error.
    const inCatalogue = !location.storeId || !!(await this.prisma.storeVariant.findFirst({ where: { storeId: location.storeId, variantId, status: 'ACTIVE' }, select: { id: true } }));
    if (!inCatalogue && quantity <= 0) throw new BadRequestException('This product is not in the store catalogue. Add it to the store first.');

    await this.prisma.$transaction(async (tx) => {
      if (!inCatalogue && location.storeId) await this.ensureStoreProduct(tx, context.organizationId, location.storeId, variantId);
      await this.postInventory(tx, context, locationId, variantId, quantity, 'ADJUSTMENT', null, reason, unitCostCents, status);
      await this.audit.record(context, 'inventory.adjusted', 'StockLocation', locationId, { variantId, quantity, status, reason }, tx);
    });
    return this.inventory(context);
  }

  async setInventoryThresholds(context: UserContext, input: JsonObject) {
    const locationId = uuid(input.locationId, 'locationId');
    const variantId = uuid(input.variantId, 'variantId');
    const location = await this.prisma.stockLocation.findFirst({ where: { id: locationId, organizationId: context.organizationId } });
    if (!location) throw new NotFoundException('Stock location not found');
    if (location.storeId) this.authorization.assertStoreAccess(context, location.storeId);
    else if (!context.isOrganisationAdministrator) throw new ForbiddenException('Organisation stock locations require organisation access');
    if (location.storeId) this.authorization.assertPermissions(context, ['inventory.manage'], location.storeId);
    if (!(await this.prisma.productVariant.findFirst({ where: { id: variantId, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new NotFoundException('Product variant not found');
    }
    const reorderPoint = finiteNumber(input.reorderPoint ?? 0, 'reorderPoint');
    const safetyStock = finiteNumber(input.safetyStock ?? 0, 'safetyStock');
    if (reorderPoint < 0 || safetyStock < 0) throw new BadRequestException('Stock thresholds cannot be negative');
    const balance = await this.prisma.inventoryBalance.upsert({ where: { locationId_variantId_status: { locationId, variantId, status: 'SELLABLE' } }, create: { organizationId: context.organizationId, locationId, variantId, status: 'SELLABLE', quantity: 0, reorderPoint, safetyStock }, update: { reorderPoint, safetyStock } });
    await this.audit.record(context, 'inventory.thresholds.updated', 'InventoryBalance', `${locationId}:${variantId}:SELLABLE`, { reorderPoint, safetyStock });
    return { locationId: balance.locationId, variantId: balance.variantId, reorderPoint: num(balance.reorderPoint), safetyStock: num(balance.safetyStock) };
  }

  async rebuildInventory(context: UserContext, storeId?: string) {
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['inventory.manage'], storeId);
    }
    if (!storeId && !context.isOrganisationAdministrator) throw new ForbiddenException('Select a store to rebuild its inventory');
    const locationFilter = storeId ? { location: { storeId } } : {};
    const movementFilter = storeId ? { locationId: { in: (await this.prisma.stockLocation.findMany({ where: { organizationId: context.organizationId, storeId }, select: { id: true } })).map((location) => location.id) } } : {};
    const result = await this.prisma.$transaction(async (tx) => {
      const grouped = await tx.inventoryMovement.groupBy({ by: ['locationId', 'variantId', 'status'], where: { organizationId: context.organizationId, ...movementFilter }, _sum: { quantity: true } });
      const balanceWhere = { organizationId: context.organizationId, ...locationFilter };
      const existing = await tx.inventoryBalance.findMany({ where: balanceWhere, select: { locationId: true, variantId: true, status: true, reorderPoint: true, safetyStock: true } });
      const thresholds = new Map(existing.map((row) => [`${row.locationId}:${row.variantId}:${row.status}`, row]));
      await tx.inventoryBalance.deleteMany({ where: balanceWhere });
      for (const row of grouped) {
        const threshold = thresholds.get(`${row.locationId}:${row.variantId}:${row.status}`);
        await tx.inventoryBalance.create({ data: { organizationId: context.organizationId, locationId: row.locationId, variantId: row.variantId, status: row.status, quantity: row._sum.quantity ?? 0, reorderPoint: threshold?.reorderPoint ?? 0, safetyStock: threshold?.safetyStock ?? 0 } });
      }
      await this.audit.record(context, 'inventory.projection.rebuilt', 'InventoryBalance', null, { rows: grouped.length }, tx);
      return grouped.length;
    });
    return { rebuiltBalances: result };
  }

  async previewOpeningStock(context: UserContext, input: JsonObject) {
    const rows = this.openingStockRows(input.rows);
    const requestedStoreId = typeof input.storeId === 'string' && input.storeId ? uuid(input.storeId, 'storeId') : context.defaultStoreId ?? undefined;
    if (!context.isOrganisationAdministrator && !requestedStoreId) throw new BadRequestException('Select a store for opening stock');
    if (requestedStoreId) {
      this.authorization.assertStoreAccess(context, requestedStoreId);
      this.authorization.assertPermissions(context, ['inventory.manage'], requestedStoreId);
    }
    const errors: { row: number; field: string; message: string }[] = [];
    for (const [index, row] of rows.entries()) {
      const sku = optionalString(row.sku) ?? '';
      const quantity = Number(row.quantity);
      if (!sku) errors.push({ row: index + 2, field: 'sku', message: 'SKU is required' });
      if (!Number.isFinite(quantity) || quantity <= 0) errors.push({ row: index + 2, field: 'quantity', message: 'Quantity must be positive' });
      if (sku && !(await this.prisma.productVariant.findFirst({ where: { organizationId: context.organizationId, sku }, select: { id: true } }))) errors.push({ row: index + 2, field: 'sku', message: `SKU not found: ${sku}` });
      if (row.locationId && !(await this.prisma.stockLocation.findFirst({
        where: { id: String(row.locationId), organizationId: context.organizationId, ...(requestedStoreId ? { storeId: requestedStoreId } : {}) },
        select: { id: true },
      }))) errors.push({ row: index + 2, field: 'locationId', message: 'Location not found for this store' });
    }
    return { rowCount: rows.length, validRows: Math.max(0, rows.length - new Set(errors.map((error) => error.row)).size), errors };
  }

  async commitOpeningStock(context: UserContext, input: JsonObject) {
    const preview = await this.previewOpeningStock(context, input);
    if (preview.errors.length) throw new BadRequestException({ message: 'Opening stock contains validation errors', errors: preview.errors });
    const rows = this.openingStockRows(input.rows);
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const variant = await tx.productVariant.findFirstOrThrow({ where: { organizationId: context.organizationId, sku: String(row.sku).trim() }, select: { id: true } });
        const location = row.locationId ? await tx.stockLocation.findFirstOrThrow({ where: { id: String(row.locationId), organizationId: context.organizationId } }) : await tx.stockLocation.findFirst({ where: { organizationId: context.organizationId, storeId: uuid(input.storeId ?? context.defaultStoreId, 'storeId') }, orderBy: { createdAt: 'asc' } });
        if (!location) throw new NotFoundException('Stock location not found');
        if (location.storeId) this.authorization.assertStoreAccess(context, location.storeId);
        else if (!context.isOrganisationAdministrator) throw new ForbiddenException('Organisation stock locations require organisation access');
        if (input.storeId && location.storeId !== input.storeId) throw new BadRequestException('Stock location does not match the selected store');
        const status = row.status === undefined ? 'SELLABLE' : oneOf(row.status, INVENTORY_STATUSES, 'status');
        if (location.storeId) await this.ensureStoreProduct(tx, context.organizationId, location.storeId, variant.id);
        await this.postInventory(tx, context, location.id, variant.id, finiteNumber(row.quantity, 'quantity'), 'RECEIPT', null, 'Opening stock import', money(row.unitCostCents ?? 0, 'unitCostCents'), status);
      }
      await this.audit.record(context, 'inventory.opening-stock.imported', 'InventoryMovement', null, { rowCount: rows.length }, tx);
    });
    return { imported: rows.length };
  }

  // ───────────── Returns ─────────────

  async createReturn(context: UserContext, input: JsonObject) {
    const saleId = uuid(input.saleId, 'saleId');
    const requestedStoreId = input.storeId === undefined ? undefined : uuid(input.storeId, 'storeId');
    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, organizationId: context.organizationId }, include: { lines: true } });
    if (!sale) throw new NotFoundException('Original sale not found');
    if (requestedStoreId && requestedStoreId !== sale.storeId) throw new BadRequestException('Return store does not match the original sale');
    this.authorization.assertStoreAccess(context, sale.storeId);
    this.authorization.assertPermissions(context, ['refund.create'], sale.storeId);
    const session = await this.openSessionRow(context, uuid(input.sessionId, 'sessionId'));
    if (session.storeId !== sale.storeId) throw new BadRequestException('Return session must belong to the store of the original sale');

    const rawLines = Array.isArray(input.lines) ? input.lines as JsonObject[] : [];
    if (!rawLines.length) throw new BadRequestException('At least one return line is required');
    const restockStatus = input.restockStatus === undefined ? 'SELLABLE' : oneOf(input.restockStatus, INVENTORY_STATUSES, 'restockStatus');
    const refundTender = input.tenderType === undefined ? 'CASH' : oneOf(input.tenderType, TENDERS, 'tenderType');
    const reason = requiredString(input.reason ?? 'Customer return', 'reason');

    const returned = await this.prisma.returnLine.groupBy({
      by: ['saleLineId'],
      where: { saleLineId: { in: sale.lines.map((line) => line.id) } },
      _sum: { quantity: true },
    });
    const alreadyReturned = new Map(returned.map((row) => [row.saleLineId, num(row._sum.quantity)]));

    // Pro-rate the sale-level discount and rounding across every line, so a partial refund never gives back
    // more than the customer paid. saleGross is the pre-discount sum of line totals; saleTotal is what was paid.
    const saleGross = sale.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const saleTotal = sale.totalCents;
    const discountRatio = saleGross > 0 ? saleTotal / saleGross : 1;
    const requested = new Map<string, number>();
    const returnLines = rawLines.map((raw) => {
      const saleLineId = uuid(raw.saleLineId, 'saleLineId');
      const original = sale.lines.find((line) => line.id === saleLineId);
      if (!original) throw new BadRequestException('Sale line not found');
      const quantity = finiteNumber(raw.quantity, 'quantity');
      const requestedSoFar = (requested.get(saleLineId) ?? 0) + quantity;
      requested.set(saleLineId, requestedSoFar);
      const soldQuantity = num(original.quantity);
      if (quantity <= 0 || (alreadyReturned.get(saleLineId) ?? 0) + requestedSoFar > soldQuantity) {
        throw new BadRequestException('Return quantity exceeds the remaining sale quantity');
      }
      // Refund the tax-inclusive line value pro rata, so tax-exclusive items refund their tax too,
      // then apply the sale-level discount ratio so the refund never exceeds what was actually paid.
      const amount = Math.round((original.lineTotalCents * quantity * discountRatio) / soldQuantity);
      const tax = Math.round((original.taxCents * quantity * discountRatio) / soldQuantity);
      const lineRestockStatus = raw.restockStatus === undefined ? restockStatus : oneOf(raw.restockStatus, INVENTORY_STATUSES, 'restockStatus');
      return { saleLineId, variantId: original.variantId, quantity, amount, tax, restockStatus: lineRestockStatus };
    });
    const total = returnLines.reduce((sum, line) => sum + line.amount, 0);
    const tax = returnLines.reduce((sum, line) => sum + line.tax, 0);
    const managerApprovalUserId = await this.assertRefundAllowed(context, sale.storeId, total, input.approvalId, input.managerPin);

    const result = await this.prisma.$transaction(async (tx) => {
      const creditNoteNumber = await this.nextDocumentNumber(tx, context.organizationId, sale.storeId, 'CN');
      const created = await tx.saleReturn.create({
        data: {
          organizationId: context.organizationId,
          originalSaleId: saleId,
          storeId: sale.storeId,
          sessionId: session.id,
          creditNoteNumber,
          refundTender,
          subtotalCents: total - tax,
          taxCents: tax,
          totalCents: total,
          reason,
          createdById: context.userId,
          lines: {
            create: returnLines.map((line) => ({
              saleLineId: line.saleLineId,
              variantId: line.variantId,
              quantity: line.quantity,
              restockStatus: line.restockStatus,
              amountCents: line.amount,
            })),
          },
        },
      });
      const location = await this.storeLocation(tx, context.organizationId, sale.storeId);
      if (location) {
        for (const line of returnLines) {
          await this.postInventory(tx, context, location.id, line.variantId, line.quantity, 'RETURN', created.id, 'Customer return', 0, line.restockStatus);
        }
      }
      if (refundTender === 'CASH') {
        await tx.registerSession.update({ where: { id: session.id }, data: { expectedCashCents: { decrement: total } } });
      }
      if (managerApprovalUserId) {
        await tx.approval.create({ data: {
          organizationId: context.organizationId,
          action: 'RETURN_REFUND',
          referenceId: created.id,
          requestedById: context.userId,
          approvedById: managerApprovalUserId,
          reason,
          status: 'APPROVED',
          decidedAt: new Date(),
        } });
      }
      await this.audit.record(context, 'return.completed', 'Return', created.id, { saleId, total, creditNoteNumber }, tx);
      return created;
    });
    return {
      id: result.id,
      creditNoteNumber: result.creditNoteNumber,
      originalSaleId: result.originalSaleId,
      totalCents: result.totalCents,
      reason: result.reason,
      createdAt: result.createdAt,
    };
  }

  async listReturns(context: UserContext, storeId?: string) {
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store) {
      this.authorization.assertStoreAccess(context, store);
      this.authorization.assertPermissions(context, ['refund.create'], store);
    }
    const accessible = store ? [store] : await this.authorization.permittedStoreIds(context, 'refund.create');
    const returns = await this.prisma.saleReturn.findMany({
      where: { organizationId: context.organizationId, ...(accessible ? { storeId: { in: accessible } } : {}) },
      include: { originalSale: { select: { receiptNumber: true } }, createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return returns.map((value) => ({
      id: value.id,
      creditNoteNumber: value.creditNoteNumber,
      originalSaleId: value.originalSaleId,
      receiptNumber: value.originalSale.receiptNumber,
      storeId: value.storeId,
      refundTender: value.refundTender,
      totalCents: value.totalCents,
      reason: value.reason,
      status: value.status,
      createdAt: value.createdAt,
      cashier: `${value.createdBy.firstName} ${value.createdBy.lastName}`.trim(),
    }));
  }

  async getReturn(context: UserContext, returnId: string) {
    const value = await this.prisma.saleReturn.findFirst({
      where: { id: uuid(returnId, 'returnId'), organizationId: context.organizationId },
      include: { originalSale: { include: { lines: true, payments: true } }, lines: true, createdBy: { select: { firstName: true, lastName: true } } },
    });
    if (!value) throw new NotFoundException('Return not found');
    this.authorization.assertStoreAccess(context, value.storeId);
    this.authorization.assertPermissions(context, ['refund.create'], value.storeId);
    return { ...value, originalSale: { ...value.originalSale, lines: value.originalSale.lines.map((line) => ({ ...line, quantity: num(line.quantity) })) }, lines: value.lines.map((line) => ({ ...line, quantity: num(line.quantity) })) };
  }

  // ───────────── Reporting & alerts ─────────────

  async reports(context: UserContext, from?: string, to?: string, storeId?: string, registerId?: string, cashierId?: string) {
    const end = to ? this.dayBoundary(to, 'to', true) : new Date();
    const start = from ? this.dayBoundary(from, 'from', false) : new Date(Date.now() - 30 * 86_400_000);
    const period = { gte: start, lte: end };
    const orgId = context.organizationId;
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store) {
      if (!(await this.prisma.store.findFirst({ where: { id: store, organizationId: orgId }, select: { id: true } }))) throw new NotFoundException('Store not found');
      this.authorization.assertStoreAccess(context, store);
      this.authorization.assertPermissions(context, ['report.view'], store);
    }
    const accessibleStores = store ? [store] : await this.authorization.permittedStoreIds(context, 'report.view');
    const scopedStore = store ?? (accessibleStores ? { in: accessibleStores } : undefined);
    const register = registerId ? uuid(registerId, 'registerId') : undefined;
    const cashier = cashierId ? uuid(cashierId, 'cashierId') : undefined;
    if (register && !(await this.prisma.register.findFirst({ where: { id: register, organizationId: orgId, ...(store ? { storeId: store } : {}) }, select: { id: true } }))) {
      throw new NotFoundException('Register not found');
    }
    if (cashier && !(await this.prisma.user.findFirst({ where: { id: cashier, organizationId: orgId }, select: { id: true } }))) {
      throw new NotFoundException('Cashier not found');
    }

    const saleWhere: Prisma.SaleWhereInput = {
      organizationId: orgId,
      status: 'COMPLETED',
      createdAt: period,
      ...(scopedStore ? { storeId: scopedStore } : {}),
      ...(register ? { registerId: register } : {}),
      ...(cashier ? { createdById: cashier } : {}),
    };
    const returnWhere: Prisma.SaleReturnWhereInput = {
      organizationId: orgId,
      createdAt: period,
      ...(scopedStore ? { storeId: scopedStore } : {}),
      ...(cashier ? { createdById: cashier } : {}),
      ...(register ? { session: { registerId: register } } : {}),
    };

    const [sales, tenders, returns, topProducts, saleRows, sessions] = await Promise.all([
      this.prisma.sale.aggregate({
        where: saleWhere,
        _count: { _all: true },
        _sum: { subtotalCents: true, taxCents: true, totalCents: true, discountCents: true },
      }),
      this.prisma.salePayment.groupBy({
        by: ['tenderType'],
        where: { sale: saleWhere },
        _sum: { amountCents: true },
      }),
      this.prisma.saleReturn.aggregate({
        where: returnWhere,
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
      this.prisma.saleLine.groupBy({
        by: ['variantId', 'sku', 'name'],
        where: { sale: saleWhere },
        _sum: { quantity: true, lineTotalCents: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),
      this.prisma.sale.findMany({
        where: saleWhere,
        select: {
          id: true,
          createdAt: true,
          totalCents: true,
          lines: { select: { quantity: true, lineTotalCents: true, taxCents: true, unitCostCents: true, taxRateBps: true, hsnCode: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.registerSession.findMany({
        where: {
          organizationId: orgId,
          openedAt: period,
          ...(scopedStore ? { storeId: scopedStore } : {}),
          ...(register ? { registerId: register } : {}),
          ...(cashier ? { openedById: cashier } : {}),
        },
        include: { register: { select: { name: true, code: true } }, openedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

    const trend = new Map<string, { sales: number; transactions: number }>();
    const byHour = new Map<number, { sales: number; transactions: number }>();
    const gst = new Map<string, { hsnCode: string; rateBps: number; taxableCents: number; taxCents: number; grossCents: number }>();
    let itemCount = 0;
    let costCents = 0;
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    for (const sale of saleRows) {
      const day = sale.createdAt.toISOString().slice(0, 10);
      const dayValue = trend.get(day) ?? { sales: 0, transactions: 0 };
      dayValue.sales += sale.totalCents;
      dayValue.transactions += 1;
      trend.set(day, dayValue);
      if (day === todayKey) {
        const hour = sale.createdAt.getUTCHours();
        const hourValue = byHour.get(hour) ?? { sales: 0, transactions: 0 };
        hourValue.sales += sale.totalCents;
        hourValue.transactions += 1;
        byHour.set(hour, hourValue);
      }
      for (const line of sale.lines) {
        const quantity = num(line.quantity);
        itemCount += quantity;
        costCents += Math.round(line.unitCostCents * quantity);
        const key = `${line.hsnCode}|${line.taxRateBps}`;
        const value = gst.get(key) ?? { hsnCode: line.hsnCode, rateBps: line.taxRateBps, taxableCents: 0, taxCents: 0, grossCents: 0 };
        value.taxableCents += line.lineTotalCents - line.taxCents;
        value.taxCents += line.taxCents;
        value.grossCents += line.lineTotalCents;
        gst.set(key, value);
      }
    }
    const previousWeekStart = new Date(now.getTime() - 7 * 86_400_000);
    const previousWeekKey = previousWeekStart.toISOString().slice(0, 10);
    const today = trend.get(todayKey) ?? { sales: 0, transactions: 0 };
    const previousWeek = trend.get(previousWeekKey) ?? { sales: 0, transactions: 0 };
    const tenderTotal = tenders.reduce((sum, tender) => sum + (tender._sum.amountCents ?? 0), 0);

    return {
      period: { from: start.toISOString(), to: end.toISOString() },
      sales: {
        count: sales._count._all,
        subtotalCents: sales._sum.subtotalCents ?? 0,
        taxCents: sales._sum.taxCents ?? 0,
        totalCents: sales._sum.totalCents ?? 0,
        discountsCents: sales._sum.discountCents ?? 0,
      },
      tenders: tenders.map((tender) => ({ tenderType: tender.tenderType, amountCents: tender._sum.amountCents ?? 0 })),
      returns: { count: returns._count._all, totalCents: returns._sum.totalCents ?? 0 },
      kpis: {
        averageOrderValueCents: sales._count._all ? Math.round((sales._sum.totalCents ?? 0) / sales._count._all) : 0,
        itemsPerSale: sales._count._all ? itemCount / sales._count._all : 0,
        grossMarginCents: (sales._sum.totalCents ?? 0) - costCents,
        today: { salesCents: today.sales, transactions: today.transactions },
        sameWeekdayLastWeek: { salesCents: previousWeek.sales, transactions: previousWeek.transactions },
      },
      trend: [...trend.entries()].map(([day, value]) => ({ day, sales: value.sales, transactions: value.transactions })),
      byHour: [...byHour.entries()].sort(([a], [b]) => a - b).map(([hour, value]) => ({ hour: `${String(hour).padStart(2, '0')}:00`, sales: value.sales, transactions: value.transactions })),
      gst: [...gst.values()].sort((a, b) => a.rateBps - b.rateBps || a.hsnCode.localeCompare(b.hsnCode)),
      tenderTotalCents: tenderTotal,
      cashReconciliation: sessions.map((session) => ({
        sessionId: session.id,
        storeId: session.storeId,
        registerId: session.registerId,
        register: session.register.name || session.register.code,
        cashier: `${session.openedBy.firstName} ${session.openedBy.lastName}`.trim(),
        status: session.status,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        expectedCashCents: session.expectedCashCents,
        countedCashCents: session.countedCashCents,
        varianceCents: session.varianceCents,
      })),
      topProducts: topProducts.map((product) => ({
        sku: product.sku,
        name: product.name,
        quantity: num(product._sum.quantity),
        totalCents: product._sum.lineTotalCents ?? 0,
      })),
      alerts: await this.alerts(context, store),
    };
  }

  async reportCsv(context: UserContext, from?: string, to?: string, storeId?: string, registerId?: string, cashierId?: string) {
    const report = await this.reports(context, from, to, storeId, registerId, cashierId);
    const rows: (string | number | null)[][] = [
      ['section', 'key', 'value', 'secondary'],
      ['sales', 'count', report.sales.count, ''],
      ['sales', 'subtotalCents', report.sales.subtotalCents, ''],
      ['sales', 'taxCents', report.sales.taxCents, ''],
      ['sales', 'totalCents', report.sales.totalCents, ''],
      ['returns', 'count', report.returns.count, ''],
      ['returns', 'totalCents', report.returns.totalCents, ''],
      ...report.tenders.map((tender) => ['tender', tender.tenderType, tender.amountCents, '']),
      ...report.gst.map((item) => ['gst', item.hsnCode || 'UNSPECIFIED', item.taxCents, item.rateBps / 100]),
      ...report.cashReconciliation.map((session) => ['cashReconciliation', session.sessionId, session.varianceCents, session.status]),
    ];
    return rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\n') + '\n';
  }

  async alerts(context: UserContext, storeId?: string) {
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store && !(await this.prisma.store.findFirst({ where: { id: store, organizationId: context.organizationId }, select: { id: true } }))) {
      throw new NotFoundException('Store not found');
    }
    if (store) this.authorization.assertStoreAccess(context, store);
    if (store) this.authorization.assertPermissions(context, ['report.view'], store);
    const accessibleStores = store ? [store] : await this.authorization.permittedStoreIds(context, 'report.view');
    const alerts = await this.prisma.alert.findMany({
      where: {
        organizationId: context.organizationId,
        ...(store ? { storeId: store } : accessibleStores ? { storeId: { in: accessibleStores } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return alerts.map((alert) => ({
      id: alert.id,
      storeId: alert.storeId,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      referenceId: alert.referenceId,
      status: alert.status,
      createdAt: alert.createdAt,
    }));
  }

  async acknowledgeAlert(context: UserContext, alertId: string) {
    const id = uuid(alertId, 'alertId');
    const alert = await this.prisma.alert.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.storeId) this.authorization.assertStoreAccess(context, alert.storeId);
    else if (!context.isOrganisationAdministrator) throw new ForbiddenException('Organisation alerts require organisation access');
    if (alert.storeId) this.authorization.assertPermissions(context, ['report.view'], alert.storeId);
    await this.prisma.$transaction(async (tx) => {
      await tx.alert.update({ where: { id }, data: { status: 'ACKNOWLEDGED' } });
      await this.audit.record(context, 'alert.acknowledged', 'Alert', id, {}, tx);
    });
    return { id, status: 'ACKNOWLEDGED' };
  }

  // ───────────── Customers ─────────────

  async listCustomers(context: UserContext, requestedStoreId?: string) {
    const storeId = requestedStoreId ? uuid(requestedStoreId, 'storeId') : undefined;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['customer.view'], storeId);
    }
    const reachable = storeId ? [storeId] : await this.authorization.permittedStoreIds(context, 'customer.view');
    const customers = await this.prisma.customer.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: 'asc' },
    });
    return customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      groupName: customer.groupName,
      notes: customer.notes,
      consentMarketing: customer.consentMarketing,
      walletBalanceCents: customer.walletBalanceCents,
      pointsBalance: customer.pointsBalance,
      createdAt: customer.createdAt,
    }));
  }

  async getCustomer(context: UserContext, customerId: string, requestedStoreId?: string) {
    const id = uuid(customerId, 'customerId');
    const storeId = requestedStoreId ? uuid(requestedStoreId, 'storeId') : undefined;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['customer.view'], storeId);
    }
    const reachable = storeId ? [storeId] : await this.authorization.permittedStoreIds(context, 'customer.view');
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: context.organizationId },
      include: {
        sales: {
          where: { status: 'COMPLETED', ...(reachable ? { storeId: { in: reachable } } : {}) },
          select: { id: true, receiptNumber: true, storeId: true, totalCents: true, createdAt: true, returns: { select: { id: true, creditNoteNumber: true, totalCents: true, createdAt: true } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const sales = customer.sales.map((sale) => ({
      id: sale.id,
      receiptNumber: sale.receiptNumber,
      storeId: sale.storeId,
      totalCents: sale.totalCents,
      createdAt: sale.createdAt,
      returns: sale.returns,
    }));
    const ledger = await this.prisma.customerLedger.findMany({
      where: { customerId: customer.id, ...(reachable ? { referenceId: { in: sales.map((sale) => sale.id) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      groupName: customer.groupName,
      notes: customer.notes,
      consentMarketing: customer.consentMarketing,
      walletBalanceCents: customer.walletBalanceCents,
      pointsBalance: customer.pointsBalance,
      createdAt: customer.createdAt,
      lifetimeSpendCents: sales.reduce((sum, sale) => sum + sale.totalCents, 0),
      sales,
      ledger,
    };
  }

  async createCustomer(context: UserContext, input: JsonObject) {
    const customer = await this.prisma.customer.create({
      data: {
        organizationId: context.organizationId,
        name: requiredString(input.name, 'name'),
        phone: optionalString(input.phone) ?? '',
        email: optionalString(input.email)?.toLowerCase() ?? '',
        groupName: optionalString(input.groupName) || 'General',
        notes: optionalString(input.notes) ?? '',
        consentMarketing: input.consentMarketing === true,
      },
    });
    return { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, groupName: customer.groupName, walletBalanceCents: customer.walletBalanceCents, pointsBalance: customer.pointsBalance };
  }

  async customerLedger(context: UserContext, customerId: string, input: JsonObject) {
    const storeId = typeof input.storeId === 'string' ? uuid(input.storeId, 'storeId') : undefined;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['customer.manage'], storeId);
    }
    const reachable = storeId ? [storeId] : await this.authorization.permittedStoreIds(context, 'customer.manage');
    const customer = await this.prisma.customer.findFirst({
      where: { id: uuid(customerId, 'customerId'), organizationId: context.organizationId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    const type = oneOf(input.type, Object.values(CustomerLedgerType) as CustomerLedgerType[], 'type');
    const amount = type === 'CREDIT' || type === 'DEBIT' ? money(input.amountCents) : 0;
    const points = type === 'POINTS_EARN' || type === 'POINTS_REDEEM' ? Math.trunc(finiteNumber(input.points, 'points')) : 0;
    if (points < 0) throw new BadRequestException('points must not be negative');
    const walletDelta = type === 'CREDIT' ? amount : type === 'DEBIT' ? -amount : 0;
    const pointsDelta = type === 'POINTS_EARN' ? points : type === 'POINTS_REDEEM' ? -points : 0;

    const updated = await this.prisma.$transaction(async (tx) => {
      // Balances can never go negative: a debit or redemption only applies if the balance covers it.
      const result = await tx.customer.updateMany({
        where: {
          id: customer.id,
          ...(walletDelta < 0 ? { walletBalanceCents: { gte: -walletDelta } } : {}),
          ...(pointsDelta < 0 ? { pointsBalance: { gte: -pointsDelta } } : {}),
        },
        data: { walletBalanceCents: { increment: walletDelta }, pointsBalance: { increment: pointsDelta } },
      });
      if (result.count === 0) throw new BadRequestException('Insufficient wallet or points balance');
      await tx.customerLedger.create({
        data: { customerId: customer.id, type, amountCents: walletDelta, points: pointsDelta, referenceId: optionalString(input.referenceId) || null },
      });
      return tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
    });
    return { id: updated.id, name: updated.name, walletBalanceCents: updated.walletBalanceCents, pointsBalance: updated.pointsBalance };
  }

  // ───────────── Promotions & bundles ─────────────

  async listPromotions(context: UserContext) {
    this.requireOrganizationPermission(context, 'promotion.manage');
    const promotions = await this.prisma.promotion.findMany({ where: { organizationId: context.organizationId }, orderBy: { code: 'asc' } });
    return promotions.map((promotion) => this.promotionDto(promotion));
  }

  async createPromotion(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'promotion.manage');
    const type = input.type === undefined ? 'PERCENT' : oneOf(input.type, Object.values(PromotionType) as PromotionType[], 'type');
    const value = finiteNumber(input.value, 'value');
    if (value <= 0 || (type === 'PERCENT' && value > 100)) throw new BadRequestException('Promotion value is out of range');
    const startsAt = this.optionalDate(input.startsAt, 'startsAt');
    const endsAt = this.optionalDate(input.endsAt, 'endsAt');
    try {
      const promotion = await this.prisma.promotion.create({
        data: {
          organizationId: context.organizationId,
          code: requiredString(input.code, 'code').toUpperCase(),
          type,
          value,
          minSubtotalCents: money(input.minSubtotalCents ?? 0, 'minSubtotalCents'),
          usageLimit: input.usageLimit === undefined ? null : Math.trunc(finiteNumber(input.usageLimit, 'usageLimit')),
          startsAt,
          endsAt,
        },
      });
      return this.promotionDto(promotion);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A promotion with this code already exists');
      throw error;
    }
  }

  async listBundles(context: UserContext) {
    this.requireOrganizationPermission(context, 'promotion.manage');
    const bundles = await this.prisma.bundle.findMany({ where: { organizationId: context.organizationId }, orderBy: { name: 'asc' } });
    return bundles.map((bundle) => ({ id: bundle.id, name: bundle.name, sku: bundle.sku, priceCents: bundle.priceCents, status: bundle.status }));
  }

  async createBundle(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'promotion.manage');
    const components = Array.isArray(input.components) ? input.components as JsonObject[] : [];
    if (!components.length) throw new BadRequestException('Bundle needs at least one component');
    const parsed = components.map((component) => {
      const quantity = finiteNumber(component.quantity, 'quantity');
      if (quantity <= 0) throw new BadRequestException('Component quantity must be positive');
      return { variantId: uuid(component.variantId, 'variantId'), quantity };
    });
    await this.assertVariantsInOrganization(context.organizationId, parsed.map((component) => component.variantId));
    try {
      const bundle = await this.prisma.bundle.create({
        data: {
          organizationId: context.organizationId,
          name: requiredString(input.name, 'name'),
          sku: requiredString(input.sku, 'sku').toUpperCase(),
          priceCents: money(input.priceCents, 'priceCents'),
          components: { create: parsed },
        },
      });
      return { id: bundle.id, name: bundle.name, sku: bundle.sku, priceCents: bundle.priceCents, status: bundle.status };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A bundle with this SKU already exists, or a component is repeated');
      throw error;
    }
  }

  // ───────────── Transfers ─────────────

  async listTransfers(context: UserContext) {
    this.requireOrganizationPermission(context, 'transfer.manage');
    const transfers = await this.prisma.transfer.findMany({
      where: { organizationId: context.organizationId },
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return transfers.map((transfer) => this.transferDto(transfer));
  }

  async createTransfer(context: UserContext, input: JsonObject) {
    this.requireOrganizationPermission(context, 'transfer.manage');
    const lines = Array.isArray(input.lines) ? input.lines as JsonObject[] : [];
    if (!lines.length) throw new BadRequestException('Transfer needs at least one line');
    const fromLocationId = uuid(input.fromLocationId, 'fromLocationId');
    const toLocationId = uuid(input.toLocationId, 'toLocationId');
    if (fromLocationId === toLocationId) throw new BadRequestException('Source and destination must differ');
    const parsed = lines.map((line) => {
      const quantity = finiteNumber(line.quantity, 'quantity');
      if (quantity <= 0) throw new BadRequestException('Line quantity must be positive');
      return { variantId: uuid(line.variantId, 'variantId'), requestedQuantity: quantity };
    });
    const locations = await this.prisma.stockLocation.count({ where: { organizationId: context.organizationId, id: { in: [fromLocationId, toLocationId] } } });
    if (locations !== 2) throw new NotFoundException('Stock location not found');
    await this.assertVariantsInOrganization(context.organizationId, parsed.map((line) => line.variantId));

    const transfer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.transfer.create({
        data: {
          organizationId: context.organizationId,
          fromLocationId,
          toLocationId,
          notes: optionalString(input.notes) ?? '',
          createdById: context.userId,
          lines: { create: parsed },
        },
        include: TRANSFER_INCLUDE,
      });
      await this.audit.record(context, 'transfer.requested', 'Transfer', created.id, { fromLocationId, toLocationId }, tx);
      return created;
    });
    return this.transferDto(transfer);
  }

  async updateTransfer(context: UserContext, transferId: string, input: JsonObject) {
    this.requireOrganizationPermission(context, 'transfer.manage');
    const status = oneOf(input.status, TRANSFER_STATUSES, 'status');
    const transfer = await this.prisma.transfer.findFirst({ where: { id: uuid(transferId, 'transferId'), organizationId: context.organizationId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (!TRANSFER_FLOW[transfer.status].includes(status)) {
      throw new ConflictException(`A ${transfer.status} transfer cannot move to ${status}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const lines = await tx.transferLine.findMany({ where: { transferId: transfer.id } });
      const dispatched = transfer.status === 'DISPATCHED' || transfer.status === 'IN_TRANSIT';
      if (!dispatched && (status === 'DISPATCHED' || status === 'IN_TRANSIT')) {
        // Stock leaves the source location now.
        for (const line of lines) {
          const quantity = Number(line.requestedQuantity);
          const balance = await tx.inventoryBalance.findUnique({ where: { locationId_variantId_status: { locationId: transfer.fromLocationId, variantId: line.variantId, status: 'SELLABLE' } } });
          if (Number(balance?.quantity ?? 0) < quantity) throw new ConflictException('Not enough sellable stock at the source location to dispatch this transfer');
          await this.postInventory(tx, context, transfer.fromLocationId, line.variantId, -quantity, 'TRANSFER_OUT', transfer.id, 'Stock transfer dispatched', 0, 'SELLABLE');
          await tx.transferLine.update({ where: { id: line.id }, data: { dispatchedQuantity: quantity } });
        }
      } else if (status === 'RECEIVED') {
        // Stock arrives at the destination.
        const toLocation = await tx.stockLocation.findUniqueOrThrow({ where: { id: transfer.toLocationId }, select: { storeId: true } });
        for (const line of lines) {
          const quantity = Number(line.dispatchedQuantity);
          await this.postInventory(tx, context, transfer.toLocationId, line.variantId, quantity, 'TRANSFER_IN', transfer.id, 'Stock transfer received', 0, 'SELLABLE');
          await tx.transferLine.update({ where: { id: line.id }, data: { receivedQuantity: quantity } });
          if (toLocation.storeId) await this.ensureStoreProduct(tx, context.organizationId, toLocation.storeId, line.variantId);
        }
      } else if (status === 'CANCELLED' && dispatched) {
        // Put dispatched stock back at the source.
        for (const line of lines) {
          const quantity = Number(line.dispatchedQuantity);
          if (quantity <= 0) continue;
          await this.postInventory(tx, context, transfer.fromLocationId, line.variantId, quantity, 'TRANSFER_IN', transfer.id, 'Stock transfer cancelled, returned to source', 0, 'SELLABLE');
        }
      }
      const result = await tx.transfer.update({
        where: { id: transfer.id },
        data: { status },
        include: TRANSFER_INCLUDE,
      });
      await this.audit.record(context, 'transfer.status-changed', 'Transfer', transfer.id, { from: transfer.status, to: status }, tx);
      return result;
    });
    return this.transferDto(updated);
  }

  // ───────────── Demo workspace ─────────────

  async seedDemo(context: UserContext) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') throw new ForbiddenException('Demo data is disabled in production');
    const organizationId = context.organizationId;
    return this.prisma.$transaction(async (tx) => {
      let store = await tx.store.findUnique({ where: { organizationId_code: { organizationId, code: 'MAIN' } } });
      if (!store) {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
        const entitlement = await tx.organizationEntitlement.findUnique({ where: { organizationId } });
        const current = await tx.store.count({ where: { organizationId, status: 'ACTIVE' } });
        if (!entitlement || current >= entitlement.maxStores) throw new ConflictException(`Store limit reached (${entitlement?.maxStores ?? 0})`);
        store = await tx.store.create({ data: { organizationId, code: 'MAIN', name: 'Main Store' } });
      }
      await tx.stockLocation.upsert({
        where: { organizationId_code: { organizationId, code: 'MAIN-STOCKROOM' } },
        create: { organizationId, storeId: store.id, code: 'MAIN-STOCKROOM', name: 'Main Stockroom' },
        update: {},
      });
      const register = await tx.register.upsert({
        where: { storeId_code: { storeId: store.id, code: 'REG-01' } },
        create: { organizationId, storeId: store.id, code: 'REG-01', name: 'Front Till' },
        update: {},
      });

      let variant = await tx.productVariant.findUnique({ where: { organizationId_sku: { organizationId, sku: 'MUG-BLUE' } } });
      if (!variant) {
        const category = await tx.category.findFirst({ where: { organizationId, name: 'Everyday' } })
          ?? await tx.category.create({ data: { organizationId, name: 'Everyday' } });
        const uom = await tx.unitOfMeasure.upsert({
          where: { organizationId_code: { organizationId, code: 'EA' } },
          create: { organizationId, code: 'EA', name: 'Each' },
          update: {},
        });
        const tax = await tx.taxGroup.upsert({
          where: { organizationId_code: { organizationId, code: 'GST5' } },
          create: { organizationId, code: 'GST5', name: 'GST 5%', rateBps: 500 },
          update: {},
        });
        const product = await tx.product.findFirst({ where: { organizationId, name: 'Demo Coffee Mug' } })
          ?? await tx.product.create({ data: { organizationId, categoryId: category.id, name: 'Demo Coffee Mug', brand: 'Demo' } });
        variant = await tx.productVariant.create({
          data: { organizationId, productId: product.id, sku: 'MUG-BLUE', name: 'Blue', uomId: uom.id, taxGroupId: tax.id },
        });
        await tx.barcode.upsert({
          where: { organizationId_code: { organizationId, code: '890000000001' } },
          create: { organizationId, variantId: variant.id, code: '890000000001' },
          update: {},
        });
        await tx.variantPrice.create({ data: { organizationId, variantId: variant.id, amountCents: 49900, currency: 'INR', includesTax: true } });
      }
      await this.ensureStoreProduct(tx, organizationId, store.id, variant.id);
      await tx.approvalPolicy.upsert({
        where: { organizationId_action: { organizationId, action: 'SALE_DISCOUNT' } },
        create: { organizationId, action: 'SALE_DISCOUNT', thresholdPercent: 10 },
        update: {},
      });
      const settingsRow = await tx.organizationSettings.findUnique({ where: { organizationId }, select: { settings: true } });
      const settings = (settingsRow?.settings ?? {}) as JsonObject;
      if (settings.inventoryPolicy === undefined) {
        await tx.organizationSettings.upsert({
          where: { organizationId },
          create: { organizationId, settings: { inventoryPolicy: 'ALLOW' } as Prisma.InputJsonObject },
          update: { settings: { ...settings, inventoryPolicy: 'ALLOW' } as Prisma.InputJsonObject },
        });
      }
      return { storeId: store.id, registerId: register.id, variantId: variant.id, message: 'Demo workspace is ready' };
    });
  }

  /** Every organisation category and brand, for pickers when a store creates a product. */
  async catalogLookups(context: UserContext, requestedStoreId: string) {
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    const [categories, brands] = await Promise.all([
      this.prisma.category.findMany({ where: { organizationId: context.organizationId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.brand.findMany({ where: { organizationId: context.organizationId, status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    return { categories, brands };
  }

  /** Categories and brands a store actually carries, derived from its ACTIVE catalogue. Nothing to maintain per store. */
  async storeTaxonomy(context: UserContext, requestedStoreId: string) {
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    const rows = await this.prisma.storeVariant.findMany({
      where: { storeId, status: 'ACTIVE' },
      select: { variant: { select: { productId: true, product: { select: { category: { select: { id: true, name: true } }, brandRef: { select: { id: true, name: true } }, brand: true } } } } },
    });
    const categories = new Map<string, { id: string; name: string; products: Set<string> }>();
    const brands = new Map<string, { id: string | null; name: string; products: Set<string> }>();
    for (const row of rows) {
      const { productId, product } = row.variant;
      const category = product.category;
      if (category) { const entry = categories.get(category.id) ?? { ...category, products: new Set<string>() }; entry.products.add(productId); categories.set(category.id, entry); }
      const brandName = (product.brandRef?.name ?? product.brand).trim();
      if (brandName) { const key = brandName.toLowerCase(); const entry = brands.get(key) ?? { id: product.brandRef?.id ?? null, name: brandName, products: new Set<string>() }; entry.products.add(productId); brands.set(key, entry); }
    }
    const out = <T extends { name: string; products: Set<string> }>(map: Map<string, T>) => [...map.values()].map((item) => ({ ...item, products: item.products.size })).sort((a, b) => a.name.localeCompare(b.name));
    return { categories: out(categories), brands: out(brands) };
  }

  // ───────────── Tax groups and additional charges (organisation-wide or per store) ─────────────

  /** A tax group is usable in a store when it is organisation-wide or belongs to that store. */
  private async assertTaxGroupUsable(organizationId: string, storeId: string | null, taxGroupId: string) {
    const group = await this.prisma.taxGroup.findFirst({
      where: { id: taxGroupId, organizationId, OR: [{ storeId: null }, ...(storeId ? [{ storeId }] : [])] },
      select: { id: true },
    });
    if (!group) throw new BadRequestException('Tax group not found for this store');
  }

  /** Organisation-wide records need an organisation permission; store records need it in that store. */
  private authoriseScopedWrite(context: UserContext, requestedStoreId: unknown, permission: string): string | null {
    if (requestedStoreId === undefined || requestedStoreId === null || requestedStoreId === '') {
      this.requireOrganizationPermission(context, permission);
      return null;
    }
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, [permission], storeId);
    return storeId;
  }

  async listTaxGroups(context: UserContext, requestedStoreId?: string) {
    const storeId = requestedStoreId ? uuid(requestedStoreId, 'storeId') : null;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    } else this.requireOrganizationPermission(context, 'catalog.view');
    const groups = await this.prisma.taxGroup.findMany({
      where: { organizationId: context.organizationId, OR: [{ storeId: null }, ...(storeId ? [{ storeId }] : [])] },
      orderBy: [{ storeId: 'asc' }, { name: 'asc' }],
    });
    return groups.map((group) => ({ id: group.id, code: group.code, name: group.name, hsnCode: group.hsnCode, ratePercent: group.rateBps / 100, includesTax: group.includesTax, storeId: group.storeId, scope: group.storeId ? 'STORE' : 'ORGANISATION' }));
  }

  /** A store creates a tax group that only it can see and use. Organisation-wide groups are created in the admin catalogue. */
  async createStoreTaxGroup(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['pricing.manage'], storeId);
    const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId: context.organizationId }, select: { code: true } });
    if (!store) throw new NotFoundException('Store not found');
    const name = requiredString(input.name, 'name');
    const ratePercent = finiteNumber(input.ratePercent, 'ratePercent');
    if (ratePercent < 0 || ratePercent > 100) throw new BadRequestException('GST rate must be between 0 and 100');
    const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'TAX';
    const code = `${store.code}_${slug}`;
    try {
      const group = await this.prisma.taxGroup.create({
        data: { organizationId: context.organizationId, storeId, code, name, hsnCode: optionalString(input.hsnCode) ?? '', rateBps: Math.round(ratePercent * 100), includesTax: input.includesTax === true },
      });
      await this.audit.record(context, 'tax-group.created', 'TaxGroup', group.id, { storeId, code, ratePercent }, this.prisma);
      return { id: group.id, code: group.code, name: group.name, ratePercent, storeId };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('This store already has a tax group with that name');
      throw error;
    }
  }

  private chargeDto(charge: { id: string; storeId: string | null; name: string; kind: 'FLAT' | 'PERCENT'; scope: 'PER_BILL' | 'PER_ITEM'; value: number; taxGroupId: string | null; status: string; taxGroup?: { name: string; rateBps: number } | null }) {
    return {
      id: charge.id, storeId: charge.storeId, scope: charge.storeId ? 'STORE' : 'ORGANISATION', name: charge.name, kind: charge.kind, applies: charge.scope,
      amountCents: charge.kind === 'FLAT' ? charge.value : null, ratePercent: charge.kind === 'PERCENT' ? charge.value / 100 : null,
      taxGroupId: charge.taxGroupId, taxGroupName: charge.taxGroup?.name ?? null, taxRatePercent: charge.taxGroup ? charge.taxGroup.rateBps / 100 : 0, status: charge.status,
    };
  }

  async listCharges(context: UserContext, requestedStoreId?: string) {
    const storeId = requestedStoreId ? uuid(requestedStoreId, 'storeId') : null;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['pricing.view'], storeId);
    } else this.requireOrganizationPermission(context, 'pricing.view');
    const charges = await this.prisma.charge.findMany({
      where: { organizationId: context.organizationId, OR: [{ storeId: null }, ...(storeId ? [{ storeId }] : [])] },
      include: { taxGroup: { select: { name: true, rateBps: true } } },
      orderBy: [{ storeId: 'asc' }, { name: 'asc' }],
    });
    return charges.map((charge) => this.chargeDto(charge));
  }

  private chargeValue(input: JsonObject, kind: 'FLAT' | 'PERCENT'): number {
    if (kind === 'FLAT') return money(input.amountCents, 'amountCents');
    const rate = finiteNumber(input.ratePercent, 'ratePercent');
    if (rate < 0 || rate > 100) throw new BadRequestException('Percentage must be between 0 and 100');
    return Math.round(rate * 100);
  }

  async createCharge(context: UserContext, input: JsonObject) {
    const storeId = this.authoriseScopedWrite(context, input.storeId, 'pricing.manage');
    const name = requiredString(input.name, 'name');
    const kind = oneOf(input.kind, ['FLAT', 'PERCENT'] as const, 'kind');
    const scope = input.applies === undefined ? 'PER_BILL' : oneOf(input.applies, ['PER_BILL', 'PER_ITEM'] as const, 'applies');
    const value = this.chargeValue(input, kind);
    const taxGroupId = typeof input.taxGroupId === 'string' && input.taxGroupId ? uuid(input.taxGroupId, 'taxGroupId') : null;
    if (taxGroupId) await this.assertTaxGroupUsable(context.organizationId, storeId, taxGroupId);
    const charge = await this.prisma.charge.create({ data: { organizationId: context.organizationId, storeId, name, kind, scope, value, taxGroupId }, include: { taxGroup: { select: { name: true, rateBps: true } } } });
    await this.audit.record(context, 'charge.created', 'Charge', charge.id, { storeId, name, kind, value }, this.prisma);
    return this.chargeDto(charge);
  }

  async updateCharge(context: UserContext, chargeId: string, input: JsonObject) {
    const id = uuid(chargeId, 'chargeId');
    const current = await this.prisma.charge.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Charge not found');
    this.authoriseScopedWrite(context, current.storeId, 'pricing.manage');
    const kind = input.kind === undefined ? current.kind : oneOf(input.kind, ['FLAT', 'PERCENT'] as const, 'kind');
    const hasValue = input.amountCents !== undefined || input.ratePercent !== undefined;
    const taxGroupId = input.taxGroupId === undefined ? undefined : input.taxGroupId ? uuid(input.taxGroupId, 'taxGroupId') : null;
    if (taxGroupId) await this.assertTaxGroupUsable(context.organizationId, current.storeId, taxGroupId);
    const updated = await this.prisma.charge.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: requiredString(input.name, 'name') } : {}),
        ...(input.kind !== undefined ? { kind } : {}),
        ...(hasValue ? { value: this.chargeValue(input, kind) } : {}),
        ...(input.applies !== undefined ? { scope: oneOf(input.applies, ['PER_BILL', 'PER_ITEM'] as const, 'applies') } : {}),
        ...(input.status !== undefined ? { status: oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status') } : {}),
        ...(taxGroupId !== undefined ? { taxGroupId } : {}),
      },
      include: { taxGroup: { select: { name: true, rateBps: true } } },
    });
    await this.audit.record(context, 'charge.updated', 'Charge', id, { fields: Object.keys(input) }, this.prisma);
    return this.chargeDto(updated);
  }

  /** Active charges that apply in a store: organisation-wide ones plus that store's own. */
  private async computeCharges(organizationId: string, storeId: string, lines: PricedLine[], baseNetCents: number) {
    const charges = await this.prisma.charge.findMany({
      where: { organizationId, status: 'ACTIVE', OR: [{ storeId: null }, { storeId }] },
      include: { taxGroup: { select: { rateBps: true } } },
      orderBy: { name: 'asc' },
    });
    const items = charges.map((charge) => {
      let amountCents: number;
      if (charge.kind === 'FLAT') amountCents = charge.scope === 'PER_ITEM' ? Math.round(charge.value * lines.reduce((sum, line) => sum + line.quantity, 0)) : charge.value;
      else amountCents = charge.scope === 'PER_ITEM' ? lines.reduce((sum, line) => sum + Math.round((line.netCents * charge.value) / 10000), 0) : Math.round((baseNetCents * charge.value) / 10000);
      const taxRateBps = charge.taxGroup?.rateBps ?? 0;
      return { id: charge.id, name: charge.name, amountCents, taxRateBps, taxCents: taxOnExclusive(amountCents, taxRateBps) };
    }).filter((item) => item.amountCents > 0);
    return { items, netCents: items.reduce((sum, item) => sum + item.amountCents, 0), taxCents: items.reduce((sum, item) => sum + item.taxCents, 0) };
  }

  /** Prices a cart exactly as checkout will, so the screen total, the saved sale and the invoice always agree. */
  async quoteSale(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId ?? context.defaultStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['sale.create'], storeId);
    const rawLines = Array.isArray(input.lines) ? input.lines as LineInput[] : [];
    const lines = await Promise.all(rawLines.map((line) => this.priceLine(context, line, storeId)));
    const orderDiscount = money(input.discountCents ?? 0, 'discountCents');
    const subtotal = lines.reduce((sum, line) => sum + line.netCents, 0);
    const lineDiscount = lines.reduce((sum, line) => sum + line.discountCents, 0);
    const discount = Math.min(orderDiscount, subtotal);
    const lineTax = lines.reduce((sum, line) => sum + line.taxCents, 0);
    const itemTax = Math.max(0, lineTax - Math.round((discount * lineTax) / Math.max(1, subtotal)));
    const chargePlan = await this.computeCharges(context.organizationId, storeId, lines, subtotal - discount);
    const tax = itemTax + chargePlan.taxCents;
    return {
      lines: lines.map((line) => ({ variantId: line.variantId, sku: line.sku, name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents, taxRateBps: line.taxRateBps, taxCents: line.taxCents, netCents: line.netCents, lineTotalCents: line.lineTotalCents, discountCents: line.discountCents })),
      subtotalCents: subtotal,
      discountCents: lineDiscount + discount,
      chargeCents: chargePlan.netCents,
      charges: chargePlan.items,
      taxCents: tax,
      totalCents: subtotal - discount + tax + chargePlan.netCents,
    };
  }

  // ───────────── Internals ─────────────

  /** Prices that apply to a store right now: that store's own, plus organisation-wide ones. */
  private currentPriceFilter(storeId: string | null) {
    return {
      where: { effectiveFrom: { lte: new Date() }, OR: [{ storeId: null }, ...(storeId ? [{ storeId }] : [])] },
      orderBy: { effectiveFrom: 'desc' as const },
    };
  }

  /** A store-specific price beats an organisation-wide one; within each, the most recent wins. */
  private pickPrice<T extends { storeId: string | null; effectiveFrom: Date }>(prices: T[], storeId: string | null): T | undefined {
    const latest = (list: T[]) => [...list].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    return latest(prices.filter((price) => storeId !== null && price.storeId === storeId)) ?? latest(prices.filter((price) => price.storeId === null));
  }

  private async priceLine(context: UserContext, input: LineInput, storeId: string): Promise<PricedLine> {
    const variantId = uuid(input.variantId, 'variantId');
    const quantity = finiteNumber(input.quantity ?? 1, 'quantity');
    if (quantity <= 0) throw new BadRequestException('quantity must be positive');
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, organizationId: context.organizationId, status: { in: [...SELLABLE_STATUSES] }, storeVariants: { some: { storeId, status: 'ACTIVE' } } },
      include: { product: { select: { name: true } }, taxGroup: { select: { rateBps: true, hsnCode: true } }, storeVariants: { where: { storeId }, select: { taxGroup: { select: { rateBps: true, hsnCode: true } } } }, prices: this.currentPriceFilter(storeId) },
    });
    if (!variant) throw new NotFoundException(`Sellable variant not found: ${variantId}`);
    // Tax resolution: the store's own tax group for this product, else the organisation's, else 0 %.
    const taxGroup = variant.storeVariants[0]?.taxGroup ?? variant.taxGroup;

    const price = this.pickPrice(variant.prices, storeId);
    const unitPriceCents = price?.amountCents ?? 0;
    const taxBps = taxGroup?.rateBps ?? 0;
    const gross = Math.round(unitPriceCents * quantity);
    const hasDiscountCents = input.discountCents !== undefined;
    const hasDiscountPercent = input.discountPercent !== undefined;
    if (hasDiscountCents && hasDiscountPercent) throw new BadRequestException('Use either discountCents or discountPercent, not both');
    const discountCents = hasDiscountCents
      ? money(input.discountCents, 'line discountCents')
      : hasDiscountPercent
        ? Math.round((gross * finiteNumber(input.discountPercent, 'line discountPercent')) / 100)
        : 0;
    if (discountCents < 0) throw new BadRequestException('Line discount cannot be negative');
    if (discountCents > gross) throw new BadRequestException('Line discount cannot exceed the line value');
    const discountedGross = gross - discountCents;
    const tax = price?.includesTax ? splitInclusive(discountedGross, taxBps).tax : taxOnExclusive(discountedGross, taxBps);
    const netCents = price?.includesTax ? splitInclusive(discountedGross, taxBps).net : discountedGross;
    return {
      variantId,
      sku: variant.sku,
      name: `${variant.product.name} · ${variant.name}`,
      quantity,
      unitPriceCents,
      unitCostCents: variant.costCents,
      taxRateBps: taxBps,
      hsnCode: taxGroup?.hsnCode ?? '',
      taxCents: tax,
      netCents,
      lineTotalCents: netCents + tax,
      discountCents,
      discountReason: optionalString(input.discountReason) ?? '',
      note: optionalString(input.note) ?? '',
    };
  }

  private async paymentPlan(organizationId: string, value: unknown, expectedTotalCents: number) {
    const values = Array.isArray(value) ? value as JsonObject[] : [];
    if (!values.length) throw new BadRequestException('At least one payment is required');
    const tenderTypes = values.map((payment) => oneOf(payment.tenderType, TENDERS, 'tenderType'));
    const onlyCash = tenderTypes.every((tender) => tender === 'CASH');
    const cashRoundingCents = onlyCash ? await this.cashRoundingUnit(organizationId) : 0;
    const roundedTotalCents = cashRoundingCents > 0 ? Math.round(expectedTotalCents / cashRoundingCents) * cashRoundingCents : expectedTotalCents;
    const payments = values.map((payment, index) => {
      const tenderType = tenderTypes[index]!;
      const tenderedCents = payment.tenderedCents === undefined ? null : money(payment.tenderedCents, 'tenderedCents');
      const requestedAmount = payment.amountCents === undefined ? tenderedCents : money(payment.amountCents);
      if (requestedAmount === null || requestedAmount === undefined) throw new BadRequestException('amountCents is required for every payment');
      const amountCents = onlyCash && values.length === 1 && tenderType === 'CASH' && tenderedCents !== null ? roundedTotalCents : requestedAmount;
      if (tenderedCents !== null && tenderType !== 'CASH') throw new BadRequestException('tenderedCents is only valid for cash');
      if (tenderedCents !== null && tenderedCents < amountCents) throw new BadRequestException('Cash tendered cannot be less than the applied amount');
      return {
        tenderType,
        amountCents,
        tenderedCents,
        changeCents: tenderedCents === null ? 0 : tenderedCents - amountCents,
        reference: optionalString(payment.reference) ?? '',
      };
    });
    return {
      payments,
      appliedTotalCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0),
      roundedTotalCents,
      roundingCents: roundedTotalCents - expectedTotalCents,
    };
  }

  /** Discounts above the configured threshold need an approved manager authorisation for SALE_DISCOUNT. */
  private async assertDiscountAllowed(context: UserContext, storeId: string, discountCents: number, subtotalCents: number, approvalId: unknown, managerPin: unknown): Promise<string | null> {
    const effect = this.authorization.permissionEffect(context, 'sale.discount', storeId);
    if (discountCents > 0 && (effect === null || effect === 'DENY')) throw new ForbiddenException('Missing permission: sale.discount');
    const policy = await this.prisma.approvalPolicy.findUnique({
      where: { organizationId_action: { organizationId: context.organizationId, action: 'SALE_DISCOUNT' } },
    });
    let allowed = Number.MAX_SAFE_INTEGER;
    if (policy?.status === 'ACTIVE') allowed = Math.round((subtotalCents * num(policy.thresholdPercent)) / 100);
    if (discountCents <= allowed && effect !== 'REQUIRE_APPROVAL') return null;
    const requireApproval = () => new ForbiddenException({
      code: 'REQUIRE_APPROVAL',
      action: 'SALE_DISCOUNT',
      message: 'This discount needs manager approval',
      thresholdPercent: num(policy?.thresholdPercent),
    });
    if (typeof managerPin === 'string' && managerPin.length > 0) {
      const manager = await this.prisma.user.findFirst({
        where: {
          organizationId: context.organizationId,
          id: { not: context.userId },
          status: 'ACTIVE',
          pinHash: { not: null },
          roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permissionCode: 'approval.manage', effect: { in: ['ALLOW', 'REQUIRE_APPROVAL'] } } } }, OR: [{ scopeType: 'ORGANIZATION' }, { scopeType: 'STORE', storeId }] } },
        },
        select: { id: true, pinHash: true },
      });
      if (manager?.pinHash && verifyPassword(managerPin, manager.pinHash)) return manager.id;
      throw new ForbiddenException({ code: 'REQUIRE_APPROVAL', action: 'SALE_DISCOUNT', message: 'Manager PIN is invalid' });
    }
    if (approvalId === undefined) throw requireApproval();
    const approved = isUuid(approvalId)
      ? await this.prisma.approval.findFirst({ where: { id: approvalId, organizationId: context.organizationId, action: 'SALE_DISCOUNT', status: 'APPROVED' }, select: { id: true } })
      : null;
    if (!approved) throw requireApproval();
    return null;
  }

  /** Refunds above the organisation's configured amount, or with a REQUIRE_APPROVAL role effect, need a manager. */
  private async assertRefundAllowed(context: UserContext, storeId: string, totalCents: number, approvalId: unknown, managerPin: unknown): Promise<string | null> {
    const effect = this.authorization.permissionEffect(context, 'refund.create', storeId);
    if (effect === null || effect === 'DENY') throw new ForbiddenException('Missing permission: refund.create');
    const settingsRow = await this.prisma.organizationSettings.findUnique({ where: { organizationId: context.organizationId }, select: { settings: true } });
    let thresholds: JsonObject = {};
    const configured = (settingsRow?.settings as JsonObject | null)?.approvalThresholds;
    if (typeof configured === 'string') {
      try {
        const parsed = JSON.parse(configured) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) thresholds = parsed as JsonObject;
      } catch { /* Invalid optional settings do not silently grant approval; no numeric threshold is applied. */ }
    } else if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
      thresholds = configured as JsonObject;
    }
    const thresholdCents = thresholds.refundCents === undefined ? null : Number(thresholds.refundCents);
    const needsApproval = effect === 'REQUIRE_APPROVAL' || (thresholdCents !== null && Number.isFinite(thresholdCents) && thresholdCents >= 0 && totalCents > thresholdCents);
    if (!needsApproval) return null;
    const requireApproval = () => new ForbiddenException({
      code: 'REQUIRE_APPROVAL',
      action: 'RETURN_REFUND',
      message: 'This refund needs manager approval',
      thresholdCents: thresholdCents ?? undefined,
    });
    if (typeof managerPin === 'string' && managerPin.length > 0) {
      const manager = await this.prisma.user.findFirst({
        where: {
          organizationId: context.organizationId,
          id: { not: context.userId },
          status: 'ACTIVE',
          pinHash: { not: null },
          roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permissionCode: 'approval.manage', effect: { in: ['ALLOW', 'REQUIRE_APPROVAL'] } } } }, OR: [{ scopeType: 'ORGANIZATION' }, { scopeType: 'STORE', storeId }] } },
        },
        select: { id: true, pinHash: true },
      });
      if (manager?.pinHash && verifyPassword(managerPin, manager.pinHash)) return manager.id;
      throw new ForbiddenException({ code: 'REQUIRE_APPROVAL', action: 'RETURN_REFUND', message: 'Manager PIN is invalid' });
    }
    if (approvalId === undefined) throw requireApproval();
    const approved = isUuid(approvalId)
      ? await this.prisma.approval.findFirst({ where: { id: approvalId, organizationId: context.organizationId, action: 'RETURN_REFUND', status: 'APPROVED' }, select: { approvedById: true } })
      : null;
    if (!approved) throw requireApproval();
    return approved.approvedById;
  }

  private async cashRoundingUnit(organizationId: string): Promise<number> {
    const row = await this.prisma.organizationSettings.findUnique({ where: { organizationId }, select: { settings: true } });
    const settings = (row?.settings ?? {}) as JsonObject;
    const value = Number(settings.cashRounding);
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  private denominationCount(value: unknown): { totalCents: number; items: { denominationCents: number; count: number; totalCents: number }[] } | null {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.length === 0) throw new BadRequestException('denominations must be a non-empty array');
    const items = value.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Each denomination must be an object');
      const row = raw as JsonObject;
      const denominationCents = money(row.denominationCents, 'denominationCents');
      const count = finiteNumber(row.count, 'denomination count');
      if (!Number.isInteger(count) || count < 0) throw new BadRequestException('denomination count must be a non-negative integer');
      return { denominationCents, count, totalCents: denominationCents * count };
    });
    return { totalCents: items.reduce((sum, item) => sum + item.totalCents, 0), items };
  }

  /** Sequential, gap-free numbering per store and document kind. Must run inside the document's transaction. */
  private async nextDocumentNumber(tx: Tx, organizationId: string, storeId: string, kind: 'TAX' | 'CN') {
    const sequence = await tx.documentSequence.upsert({
      where: { storeId_kind: { storeId, kind } },
      create: { organizationId, storeId, kind, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `${kind}-${date}-${String(sequence.lastValue).padStart(4, '0')}`;
  }

  private async postInventory(
    tx: Tx,
    context: UserContext,
    locationId: string,
    variantId: string,
    quantity: number,
    type: InventoryMovementType,
    referenceId: string | null,
    reason: string,
    unitCostCents: number,
    status: InventoryStatus,
  ) {
    await tx.inventoryMovement.create({
      data: { organizationId: context.organizationId, locationId, variantId, quantity, status, type, referenceId, reason, unitCostCents, actorUserId: context.userId },
    });
    await tx.inventoryBalance.upsert({
      where: { locationId_variantId_status: { locationId, variantId, status } },
      create: { organizationId: context.organizationId, locationId, variantId, status, quantity },
      update: { quantity: { increment: quantity } },
    });
  }

  private storeLocation(tx: Tx, organizationId: string, storeId: string) {
    return tx.stockLocation.findFirst({ where: { organizationId, storeId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  }

  private async negativeStockPolicy(tx: Tx, organizationId: string, storeId: string): Promise<'BLOCK' | 'WARN' | 'ALLOW'> {
    const row = await tx.organizationSettings.findUnique({ where: { organizationId }, select: { settings: true } });
    const settings = (row?.settings ?? {}) as JsonObject;
    const value = settings.inventoryPolicy;
    const policy = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject)[storeId] : undefined;
    return policy === 'WARN' || policy === 'ALLOW' ? policy : 'BLOCK';
  }

  private openingStockRows(value: unknown): JsonObject[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > 5000 || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new BadRequestException('rows must be an array of 1 to 5000 objects');
    return value as JsonObject[];
  }

  private async earnPoints(tx: Tx, customerId: string, totalCents: number, saleId: string) {
    const points = Math.floor(totalCents / 1000);
    if (points <= 0) return;
    await tx.customer.update({ where: { id: customerId }, data: { pointsBalance: { increment: points } } });
    await tx.customerLedger.create({ data: { customerId, type: 'POINTS_EARN', points, referenceId: saleId } });
  }

  private async raiseAlert(tx: Tx, context: UserContext, type: string, severity: AlertSeverity, message: string, referenceId: string | null, storeId?: string) {
    await tx.alert.create({ data: { organizationId: context.organizationId, type, severity, message, referenceId, storeId } });
  }

  private async assertVariantsInOrganization(organizationId: string, variantIds: string[]) {
    const unique = [...new Set(variantIds)];
    const found = await this.prisma.productVariant.count({ where: { organizationId, id: { in: unique } } });
    if (found !== unique.length) throw new NotFoundException('Product variant not found');
  }

  private async findSession(context: UserContext, sessionId: string, tx: Tx | PrismaService = this.prisma) {
    const session = await tx.registerSession.findFirst({ where: { id: uuid(sessionId, 'sessionId'), organizationId: context.organizationId } });
    if (!session) throw new NotFoundException('Register session not found');
    this.authorization.assertStoreAccess(context, session.storeId);
    return session;
  }

  private requireOrganizationPermission(context: UserContext, permissionCode: string): void {
    if (!context.isOrganisationAdministrator && !context.grants.some((grant) => grant.permissionCode === permissionCode && grant.scopeType === 'ORGANIZATION' && grant.effect !== 'DENY')) {
      throw new ForbiddenException(`Missing organisation-wide permission: ${permissionCode}`);
    }
  }

  private async assertApprovalStoreAccess(context: UserContext, referenceId: string): Promise<void> {
    const sale = await this.prisma.sale.findFirst({ where: { id: referenceId, organizationId: context.organizationId }, select: { storeId: true } });
    if (sale) {
      this.authorization.assertStoreAccess(context, sale.storeId);
      this.authorization.assertPermissions(context, ['approval.manage'], sale.storeId);
      return;
    }
    const value = await this.prisma.saleReturn.findFirst({ where: { id: referenceId, organizationId: context.organizationId }, select: { storeId: true } });
    if (value) {
      this.authorization.assertStoreAccess(context, value.storeId);
      this.authorization.assertPermissions(context, ['approval.manage'], value.storeId);
      return;
    }
    throw new NotFoundException('Approval not found for an accessible store');
  }

  private async openSessionRow(context: UserContext, sessionId: string, tx: Tx | PrismaService = this.prisma) {
    const session = await this.findSession(context, sessionId, tx);
    if (session.status !== 'OPEN') throw new BadRequestException('Register session is closed');
    return session;
  }

  private async sessionById(context: UserContext, sessionId: string) {
    const session = await this.prisma.registerSession.findFirstOrThrow({
      where: { id: sessionId, organizationId: context.organizationId },
      include: SESSION_INCLUDE,
    });
    return this.sessionDto(session);
  }

  private findSaleByClientId(organizationId: string, clientSaleId: string) {
    return this.prisma.sale.findUnique({
      where: { organizationId_clientSaleId: { organizationId, clientSaleId } },
      include: { lines: true, payments: true },
    });
  }

  private async findSaleOrThrow(organizationId: string, saleId: string) {
    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, organizationId }, include: { lines: true, payments: true } });
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  private csvCell(value: string | number | null): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  private dayBoundary(value: string, field: string, endOfDay: boolean): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field} must be a YYYY-MM-DD date`);
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return date;
  }

  private optionalDate(value: unknown, field: string): Date | null {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return date;
  }

  // ───────────── DTO mapping ─────────────

  private sessionDto(session: Prisma.RegisterSessionGetPayload<{ include: typeof SESSION_INCLUDE }>) {
    return {
      id: session.id,
      storeId: session.storeId,
      registerId: session.registerId,
      registerCode: session.register.code,
      registerName: session.register.name,
      openedByName: `${session.openedBy.firstName} ${session.openedBy.lastName}`.trim(),
      status: session.status,
      openingFloatCents: session.openingFloatCents,
      expectedCashCents: session.expectedCashCents,
      countedCashCents: session.countedCashCents,
      varianceCents: session.varianceCents,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
    };
  }

  private saleResult(sale: SaleWithDetails) {
    return {
      sale: {
        id: sale.id,
        receiptNumber: sale.receiptNumber,
        storeId: sale.storeId,
        registerId: sale.registerId,
        sessionId: sale.sessionId,
        status: sale.status,
        subtotalCents: sale.subtotalCents,
        discountCents: sale.discountCents,
        taxCents: sale.taxCents,
        chargeCents: sale.chargeCents,
        charges: Array.isArray(sale.charges) ? sale.charges : [],
        roundingCents: sale.roundingCents,
        totalCents: sale.totalCents,
        notes: sale.notes,
        customerId: sale.customerId,
        createdAt: sale.createdAt,
        lines: sale.lines.map((line) => ({
          id: line.id,
          variantId: line.variantId,
          sku: line.sku,
          name: line.name,
          quantity: num(line.quantity),
          unitPriceCents: line.unitPriceCents,
          discountCents: line.discountCents,
          taxCents: line.taxCents,
          lineTotalCents: line.lineTotalCents,
          note: line.note,
        })),
        payments: sale.payments.map((payment) => ({ tenderType: payment.tenderType, amountCents: payment.amountCents, tenderedCents: payment.tenderedCents, changeCents: payment.changeCents, reference: payment.reference })),
      },
    };
  }

  private locationDto(location: { id: string; storeId: string | null; code: string; name: string; status: string; createdAt: Date }) {
    return { id: location.id, storeId: location.storeId, code: location.code, name: location.name, status: location.status, createdAt: location.createdAt };
  }

  private promotionDto(promotion: Prisma.PromotionGetPayload<object>) {
    return {
      id: promotion.id,
      code: promotion.code,
      type: promotion.type,
      value: num(promotion.value),
      minSubtotalCents: promotion.minSubtotalCents,
      usageLimit: promotion.usageLimit,
      usageCount: promotion.usageCount,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      status: promotion.status,
    };
  }

  private transferDto(transfer: Prisma.TransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>) {
    return {
      id: transfer.id,
      fromLocationId: transfer.fromLocationId,
      fromLocationName: transfer.fromLocation.name,
      toLocationId: transfer.toLocationId,
      toLocationName: transfer.toLocation.name,
      status: transfer.status,
      notes: transfer.notes,
      createdAt: transfer.createdAt,
      updatedAt: transfer.updatedAt,
      lines: transfer.lines.map((line) => ({
        variantId: line.variantId,
        sku: line.variant.sku,
        name: `${line.variant.product.name} ${line.variant.name}`.trim(),
        requestedQuantity: Number(line.requestedQuantity),
        dispatchedQuantity: Number(line.dispatchedQuantity),
        receivedQuantity: Number(line.receivedQuantity),
      })),
    };
  }
}

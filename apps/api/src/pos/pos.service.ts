import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
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
import { buildReportPdf } from './report-pdf.js';
import { splitInclusive, taxOnExclusive } from '@pos/shared/gst';
import { evaluatePromotions, resolveUnitPrice, type PriceRule, type PromotionDef } from '@pos/shared/pricing';
import { financialYearLabel } from '@pos/shared/fiscal';
import { formatMinor, minorFactor } from '@pos/shared/currency';
import { currencyFromSettings } from '../common/org-currency.js';
import { DEFAULT_BILLING_SETTINGS } from '../common/billing-settings.js';
import { cleanFieldSet, cleanFieldValues, objectField } from '../common/field-config.js';
import { GST_STATES, gstinStateCode, isIntraState, validateGstin } from '@pos/shared/tax-id';
import { createHash } from 'node:crypto';
import { PaymentsService } from './payments/payments.service.js';
import { verifyPassword } from '../security/password.js';

type LineInput = { variantId?: unknown; quantity?: unknown; note?: unknown; discountCents?: unknown; discountPercent?: unknown; discountReason?: unknown; unitPriceCents?: unknown; priceIncludesTax?: unknown };

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
  /** The list (base) price before any price rule; null when the item has none (open-price items). */
  listPriceCents: number | null;
  priceSource: 'RULE' | 'BASE' | 'OPEN_PRICE';
  priceRuleName: string | null;
  openPrice: boolean;
  categoryId: string | null;
  brandId: string | null;
};

type CustomerForPricing = { id: string; name: string; phone: string; groupName: string; isBusiness: boolean; taxNumber: string; legalName: string; billingAddress: string; stateCode: string; walletBalanceCents: number; pointsBalance: number };

type SaleWithDetails = Prisma.SaleGetPayload<{ include: { lines: true; payments: true } }>;


@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
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
      this.prisma.alert.count({ where: { organizationId: context.organizationId, status: { in: ['OPEN', 'ACKNOWLEDGED'] }, ...(storeId ? { storeId } : scopedStoreIds ? { storeId: { in: scopedStoreIds } } : {}) } }),
    ]);
    return {
      phases: PHASES,
      counts: { products, variants, sales, returns, customers, inventoryMovements, alerts },
      capabilities: ['POS_CORE', 'POS_INVENTORY', 'POS_REFUNDS', 'POS_CUSTOMERS', 'POS_REPORTING_ADVANCED', 'POS_MULTI_LOCATION'],
    };
  }

  // ───────────── Catalogue search ─────────────

  async searchProducts(context: UserContext, query = '', requestedStoreId?: string, options: { variantIds?: string[]; limit?: number } = {}) {
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
        ...(options.variantIds ? { id: { in: options.variantIds } } : {}),
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
        product: { select: { name: true, brand: true, customFields: true, productTypeId: true, productType: { select: { name: true } }, category: { select: { id: true, name: true } } } },
        storeVariants: { where: { storeId: storeId ?? '00000000-0000-0000-0000-000000000000' }, select: { taxGroup: { select: { rateBps: true, status: true } } } },
        barcodes: { select: { code: true }, orderBy: { code: 'asc' } },
        prices: this.currentPriceFilter(storeId),
      },
      orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
      take: Math.max(1, Math.min(options.limit ?? 100, 500)),
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
      customFields: { ...objectField(variant.product.customFields), ...objectField(variant.customFields) },
      productTypeId: variant.product.productTypeId,
      productTypeName: variant.product.productType?.name ?? '',
      brand: variant.product.brand,
      categoryId: variant.product.category?.id ?? null,
      categoryName: variant.product.category?.name ?? '',
      priceCents: this.pickPrice(variant.prices, storeId)?.amountCents ?? 0,
      includesTax: this.pickPrice(variant.prices, storeId)?.includesTax ?? false,
      openPrice: variant.openPrice,
      floorPriceCents: variant.floorPriceCents,
      barcode: variant.barcodes[0]?.code ?? '',
      barcodes: variant.barcodes.map((barcode) => barcode.code),
      taxBps: variant.storeVariants[0]?.taxGroup?.status === 'ACTIVE' ? variant.storeVariants[0].taxGroup.rateBps : 0,
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
        include: { product: { select: { name: true, brand: true, customFields: true, productTypeId: true, productType: { select: { name: true } }, category: { select: { name: true } } } }, barcodes: { select: { code: true }, orderBy: { code: 'asc' } }, prices: this.currentPriceFilter(storeId) },
        orderBy: [{ product: { name: 'asc' } }, { name: 'asc' }],
      }),
      this.prisma.storeVariant.findMany({ where: { storeId }, include: { taxGroup: { select: { id: true, name: true, rateBps: true, status: true } } } }),
      this.prisma.inventoryBalance.findMany({ where: { organizationId: context.organizationId, status: 'SELLABLE', location: { storeId } }, select: { variantId: true, quantity: true } }),
    ]);
    const assigned = new Map(assignments.map((row) => [row.variantId, row]));
    const storeTax = new Map(assignments.map((row) => [row.variantId, row.taxGroup?.status === 'ACTIVE' ? row.taxGroup : null]));
    const stock = new Map<string, number>();
    for (const balance of balances) stock.set(balance.variantId, (stock.get(balance.variantId) ?? 0) + Number(balance.quantity));
    return variants.map((variant) => {
      const storePrice = variant.prices.filter((price) => price.storeId === storeId).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
      return {
        variantId: variant.id,
        sku: variant.sku,
        barcodes: variant.barcodes.map((barcode) => barcode.code),
        name: `${variant.product.name} ${variant.name}`.trim(),
        brand: variant.product.brand,
        category: variant.product.category?.name ?? '',
        assigned: assigned.has(variant.id),
        status: assigned.get(variant.id)?.status ?? null,
        productTypeId: variant.product.productTypeId,
        productTypeName: variant.product.productType?.name ?? '',
        customFields: { ...objectField(variant.product.customFields), ...objectField(variant.customFields) },
        priceCents: this.pickPrice(variant.prices, storeId)?.amountCents ?? 0,
        storePriceCents: storePrice?.amountCents ?? null,
        storeTaxGroupId: storeTax.get(variant.id)?.id ?? null,
        taxGroupName: storeTax.get(variant.id)?.name ?? null,
        taxRatePercent: (storeTax.get(variant.id)?.rateBps ?? 0) / 100,
        stock: stock.get(variant.id) ?? 0,
      };
    });
  }

  async assignStoreProducts(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.manage.store'], storeId);
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
    this.authorization.assertPermissions(context, ['catalog.manage.store'], storeId);
    if (input.customFields !== undefined) throw new BadRequestException('Product fields are owned by the organisation and cannot be changed by a store.');
    const current = await this.prisma.storeVariant.findUnique({ where: { storeId_variantId: { storeId, variantId } } });
    if (!current) throw new NotFoundException('This product is not in the store catalogue');
    const status = input.status === undefined ? undefined : oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status');
    if (input.priceCents !== undefined && input.priceCents !== null) throw new BadRequestException('The base price is set by the organisation and cannot be changed for one store');
    const taxGroupId = input.taxGroupId === undefined ? undefined : input.taxGroupId === null ? null : uuid(input.taxGroupId, 'taxGroupId');
    if (taxGroupId) await this.assertTaxGroupUsable(context.organizationId, storeId, taxGroupId);
    const pinned = input.pinned === undefined ? undefined : input.pinned === true;
    const pinnedRank = input.pinnedRank === undefined ? undefined : Math.trunc(finiteNumber(input.pinnedRank, 'pinnedRank'));
    await this.prisma.$transaction(async (tx) => {
      if (status || taxGroupId !== undefined || pinned !== undefined || pinnedRank !== undefined) {
        await tx.storeVariant.update({ where: { id: current.id }, data: { ...(status ? { status } : {}), ...(taxGroupId !== undefined ? { taxGroupId } : {}), ...(pinned !== undefined ? { pinned } : {}), ...(pinnedRank !== undefined ? { pinnedRank } : {}) } });
      }
      await this.audit.record(context, 'store-catalogue.updated', 'Store', storeId, { variantId, status, taxGroupId, pinned, pinnedRank }, tx);
    });
    return { storeId, variantId, status: status ?? current.status };
  }

  /**
   * The quick-key tiles: manager-pinned items first, then what this store really sells most (last N days),
   * then any other products so a new store is never empty.
   */
  async topSellers(context: UserContext, requestedStoreId: string | undefined, daysInput?: string, limitInput?: string) {
    const storeId = uuid(requestedStoreId ?? context.defaultStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    const days = Math.max(1, Math.min(365, Number(daysInput) || 30));
    const limit = Math.max(1, Math.min(60, Number(limitInput) || 24));
    const since = new Date(Date.now() - days * 86_400_000);
    const [pinnedRows, soldRows] = await Promise.all([
      this.prisma.storeVariant.findMany({ where: { storeId, status: 'ACTIVE', pinned: true }, orderBy: [{ pinnedRank: 'asc' }, { createdAt: 'asc' }], select: { variantId: true } }),
      this.prisma.saleLine.groupBy({
        by: ['variantId'],
        where: { sale: { storeId, status: 'COMPLETED', createdAt: { gte: since } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: limit * 3,
      }),
    ]);
    const pinnedIds = pinnedRows.map((row) => row.variantId);
    const sold = new Map(soldRows.map((row) => [row.variantId, num(row._sum.quantity)]));
    const ids = [...new Set([...pinnedIds, ...soldRows.map((row) => row.variantId)])];
    const cards = ids.length ? await this.searchProducts(context, '', storeId, { variantIds: ids, limit: ids.length }) : [];
    const byId = new Map(cards.map((card) => [card.variantId, card]));
    const ordered = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])).slice(0, limit);
    if (ordered.length < limit) {
      const taken = new Set(ordered.map((card) => card.variantId));
      const filler = await this.searchProducts(context, '', storeId, { limit: limit + taken.size });
      for (const card of filler) if (ordered.length < limit && !taken.has(card.variantId)) { ordered.push(card); taken.add(card.variantId); }
    }
    return { days, products: ordered.map((card) => ({ ...card, pinned: pinnedIds.includes(card.variantId), soldQuantity: sold.get(card.variantId) ?? 0 })) };
  }

  // Products and variants are created in the organization catalog, then assigned to stores.
  async createStoreProduct(_context: UserContext, _requestedStoreId: string, _input: JsonObject) {
    throw new ForbiddenException('Products are created in the organisation catalog, then assigned to stores.');
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
    this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    const pending = await this.prisma.storeVariant.findMany({
      where: { storeId, status: 'PENDING_VERIFICATION' },
      include: { taxGroup: { select: { id: true, name: true, rateBps: true } }, variant: { include: { product: { select: { name: true, brand: true, category: { select: { name: true } } } }, prices: this.currentPriceFilter(storeId) } } },
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
      taxGroup: p.taxGroup,
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
      if (line.suggestedTaxGroupId !== undefined && line.suggestedTaxGroupId !== null) throw new BadRequestException('Tax groups are selected by the destination store, not by organization distributions');
      return { variantId: uuid(line.variantId, 'variantId'), quantity, suggestedPriceCents, suggestedTaxGroupId: null };
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
        // Product distribution never assigns a store tax group; the store configures it locally.
        if (Number(line.quantity) > 0) await this.postInventory(tx, context, location.id, line.variantId, Number(line.quantity), 'TRANSFER_IN', d.id, 'Distribution dispatched', 0, 'QUARANTINE');
      }
      await tx.distribution.update({ where: { id: d.id }, data: { status: 'DISPATCHED' } });
      await this.raiseAlert(
        tx,
        context,
        'DISTRIBUTION_PENDING',
        'INFO',
        `${d.lines.length} organisation product${d.lines.length === 1 ? '' : 's'} are waiting for store review`,
        d.id,
        d.toStoreId,
      );
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
    const pendingCount = await this.prisma.storeVariant.count({ where: { storeId, status: 'PENDING_VERIFICATION' } });
    if (pendingCount === 0) {
      await this.prisma.alert.updateMany({
        where: { organizationId: context.organizationId, storeId, type: 'DISTRIBUTION_PENDING', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: context.userId, resolutionNote: 'All organisation products awaiting review have been handled', activeDedupeKey: null },
      });
    }
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
    if (input.openingFloatCents === undefined || input.openingFloatCents === null) throw new BadRequestException('Count and enter the opening float before opening this register');
    const openingFloatCents = money(input.openingFloatCents, 'openingFloatCents');

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
    const sessionKey = uuid(sessionId, 'sessionId');
    const type = oneOf(input.type, CASH_MOVEMENTS, 'type');
    const amountCents = money(input.amountCents);
    if (amountCents <= 0) throw new BadRequestException('Cash movement amount must be greater than zero');
    const reason = requiredString(input.reason, 'reason');
    const clientMovementId = optionalString(input.clientMovementId);
    if (clientMovementId && clientMovementId.length > 120) throw new BadRequestException('clientMovementId must be at most 120 characters');
    if (clientMovementId) {
      const prior = await this.prisma.cashMovement.findFirst({ where: { organizationId: context.organizationId, clientMovementId } });
      if (prior) {
        if (prior.sessionId !== sessionKey || prior.type !== type || Math.abs(prior.amountCents) !== amountCents || prior.reason !== reason) {
          throw new ConflictException('This cash movement key was already used for different details');
        }
        const priorSession = await this.findSession(context, prior.sessionId);
        this.authorization.assertPermissions(context, ['cash.manage'], priorSession.storeId);
        return this.sessionById(context, prior.sessionId);
      }
    }
    const session = await this.openSessionRow(context, sessionKey);
    this.authorization.assertPermissions(context, ['cash.manage'], session.storeId);
    const settings = await this.orgSettings(context.organizationId, session.storeId);
    const approvalThreshold = Number(settings.cashMovementApprovalCents ?? 0);
    const requiresApproval = Number.isFinite(approvalThreshold) && approvalThreshold > 0 && amountCents > approvalThreshold;
    const approvalPayload = { type, amountCents, reason };
    const approvalToken = requiresApproval && input.approvalId !== undefined
      ? await this.findApprovalToken(context, input.approvalId, 'CASH_MOVEMENT', session.storeId, sessionId, approvalPayload)
      : null;
    const approvedById = requiresApproval
      ? approvalToken?.approvedById ?? await this.verifyManagerPin(context, session.storeId, input.managerPin, 'CASH_MOVEMENT', 'This cash movement is over the configured approval limit')
      : null;
    const signed = OUTFLOW_MOVEMENTS.includes(type) ? -amountCents : amountCents;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (approvalToken) await this.consumeApprovalToken(tx, context, approvalToken.tokenId, 'CASH_MOVEMENT', session.storeId, sessionId, approvalPayload);
        const changed = await tx.registerSession.updateMany({
          where: { id: sessionId, status: 'OPEN', ...(signed < 0 ? { expectedCashCents: { gte: amountCents } } : {}) },
          data: { expectedCashCents: { increment: signed } },
        });
        if (!changed.count) throw new ConflictException(signed < 0 ? 'Cash out cannot exceed the expected cash in the drawer' : 'Register session is already closed');
        await tx.cashMovement.create({
          data: { organizationId: context.organizationId, sessionId, type, amountCents: signed, reason, actorUserId: context.userId, approvedById, clientMovementId },
        });
        if (approvedById && !approvalToken) await tx.approval.create({ data: {
          organizationId: context.organizationId,
          storeId: session.storeId,
          action: 'CASH_MOVEMENT',
          referenceId: sessionId,
          requestedById: context.userId,
          approvedById,
          reason,
          status: 'APPROVED',
          decidedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          payloadHash: this.approvalPayloadHash('CASH_MOVEMENT', session.storeId, sessionId, approvalPayload),
        } });
        await this.audit.record(context, 'cash-movement.recorded', 'RegisterSession', sessionId, { type, amountCents: signed, reason, approvedById, clientMovementId }, tx);
      });
    } catch (error) {
      if (clientMovementId && isUniqueViolation(error)) {
        const prior = await this.prisma.cashMovement.findFirst({ where: { organizationId: context.organizationId, clientMovementId } });
        if (prior?.sessionId === sessionId && prior.type === type && Math.abs(prior.amountCents) === amountCents && prior.reason === reason) return this.sessionById(context, session.id);
      }
      throw error;
    }
    return this.sessionById(context, session.id);
  }

  async closeSession(context: UserContext, sessionId: string, input: JsonObject) {
    const denominationCount = this.denominationCount(input.denominations);
    const counted = denominationCount
      ? denominationCount.totalCents
      : money(input.countedCashCents, 'countedCashCents');
    const initial = await this.findSession(context, sessionId);
    this.authorization.assertPermissions(context, ['register.close'], initial.storeId);
    const settings = await this.orgSettings(context.organizationId, initial.storeId);
    const tolerance = Math.max(0, Number(settings.cashVarianceToleranceCents ?? 0) || 0);
    const expectedVariance = counted - initial.expectedCashCents;
    const requiresReview = Math.abs(expectedVariance) > tolerance;
    const closeReason = optionalString(input.reason) ?? '';
    if (requiresReview && !closeReason.trim()) throw new BadRequestException('A reason is required for a register variance outside the configured tolerance');
    const closePayload = { countedCashCents: counted, expectedCashCents: initial.expectedCashCents, varianceCents: expectedVariance, reason: closeReason };
    const closeApprovalToken = requiresReview && input.approvalId !== undefined
      ? await this.findApprovalToken(context, input.approvalId, 'REGISTER_VARIANCE', initial.storeId, sessionId, closePayload)
      : null;
    const closeApprovedById = requiresReview
      ? closeApprovalToken?.approvedById ?? await this.verifyManagerPin(context, initial.storeId, input.managerPin, 'REGISTER_VARIANCE', 'This register variance needs manager approval')
      : null;
    const closed = await this.prisma.$transaction(async (tx) => {
      if (closeApprovalToken) await this.consumeApprovalToken(tx, context, closeApprovalToken.tokenId, 'REGISTER_VARIANCE', initial.storeId, sessionId, closePayload);
      const session = await this.openSessionRow(context, sessionId, tx);
      this.authorization.assertPermissions(context, ['register.close'], session.storeId);
      const variance = counted - session.expectedCashCents;
      if (variance !== expectedVariance) throw new ConflictException('Register cash changed during close; recount and try again');
      // `status: OPEN` in the filter makes a concurrent double-close a no-op instead of a second close.
      const result = await tx.registerSession.updateMany({
        where: { id: sessionId, status: 'OPEN' },
        data: { status: 'CLOSED', countedCashCents: counted, varianceCents: variance, closedAt: new Date(), closedById: context.userId, closeApprovedById, closeReason, forcedClosed: false },
      });
      if (result.count === 0) throw new ConflictException('Register session is already closed');
      await tx.alert.updateMany({ where: { organizationId: context.organizationId, type: 'REGISTER_NOT_CLOSED', referenceId: sessionId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: context.userId, resolutionNote: 'Register session closed', activeDedupeKey: null } });
      if (variance !== 0) {
        await this.raiseAlert(tx, context, 'CASH_VARIANCE', variance < 0 ? 'HIGH' : 'MEDIUM', `Register variance is ${formatMinor(variance, currencyFromSettings(await this.orgSettings(context.organizationId)))}`, sessionId, session.storeId);
      }
      if (closeApprovedById && !closeApprovalToken) await tx.approval.create({ data: {
        organizationId: context.organizationId,
        storeId: session.storeId,
        action: 'REGISTER_VARIANCE',
        referenceId: sessionId,
        requestedById: context.userId,
        approvedById: closeApprovedById,
        reason: closeReason,
        status: 'APPROVED',
        decidedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        payloadHash: this.approvalPayloadHash('REGISTER_VARIANCE', session.storeId, sessionId, closePayload),
      } });
      await this.audit.record(context, 'register-session.closed', 'RegisterSession', sessionId, { counted, expected: session.expectedCashCents, variance, denominations: denominationCount?.items ?? null, reason: closeReason, approvedById: closeApprovedById }, tx);
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

  async attendance(context: UserContext, storeIdInput: string) {
    const storeId = uuid(storeIdInput, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    const canViewAll = this.authorization.hasPermission(context, 'attendance.view', storeId)
      || this.authorization.hasPermission(context, 'attendance.manage', storeId);
    if (!canViewAll && !this.authorization.hasPermission(context, 'attendance.clock', storeId)) {
      throw new ForbiddenException('Missing attendance permission');
    }
    const records = await this.prisma.staffAttendance.findMany({
      where: { organizationId: context.organizationId, storeId, ...(canViewAll ? {} : { userId: context.userId }) },
      include: { user: { select: { firstName: true, lastName: true } }, clockedInBy: { select: { firstName: true, lastName: true } }, clockedOutBy: { select: { firstName: true, lastName: true } } },
      orderBy: { clockedInAt: 'desc' },
      take: 200,
    });
    return records.map((record) => ({
      id: record.id,
      userId: record.userId,
      name: `${record.user.firstName} ${record.user.lastName}`.trim(),
      status: record.status,
      clockedInAt: record.clockedInAt,
      clockedOutAt: record.clockedOutAt,
      clockedInBy: `${record.clockedInBy.firstName} ${record.clockedInBy.lastName}`.trim(),
      clockedOutBy: record.clockedOutBy ? `${record.clockedOutBy.firstName} ${record.clockedOutBy.lastName}`.trim() : null,
      clockOutReason: record.clockOutReason,
    }));
  }

  async clockIn(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['attendance.clock'], storeId);
    const targetUserId = input.userId === undefined ? context.userId : uuid(input.userId, 'userId');
    if (targetUserId !== context.userId) this.authorization.assertPermissions(context, ['attendance.manage'], storeId);
    const user = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        organizationId: context.organizationId,
        status: 'ACTIVE',
        OR: [{ stores: { some: { storeId } } }, { roles: { some: { scopeType: 'STORE', storeId } } }],
      },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Active staff member is not assigned to this store');
    try {
      const record = await this.prisma.staffAttendance.create({ data: {
        organizationId: context.organizationId,
        storeId,
        userId: targetUserId,
        clockedInById: context.userId,
      } });
      await this.audit.record(context, 'attendance.clocked-in', 'StaffAttendance', record.id, { storeId, userId: targetUserId });
      return { id: record.id, userId: targetUserId, storeId, status: record.status, clockedInAt: record.clockedInAt };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('This staff member is already clocked in at this store');
      throw error;
    }
  }

  async clockOut(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    const targetUserId = input.userId === undefined ? context.userId : uuid(input.userId, 'userId');
    const correcting = targetUserId !== context.userId;
    this.authorization.assertPermissions(context, [correcting ? 'attendance.manage' : 'attendance.clock'], storeId);
    const reason = optionalString(input.reason) ?? '';
    if (correcting && !reason.trim()) throw new BadRequestException('A reason is required when correcting another staff member’s clock-out');
    const record = await this.prisma.staffAttendance.findFirst({ where: {
      organizationId: context.organizationId,
      storeId,
      userId: targetUserId,
      status: 'OPEN',
    } });
    if (!record) throw new NotFoundException('No open attendance record was found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.staffAttendance.updateMany({
        where: { id: record.id, status: 'OPEN' },
        data: { status: 'CLOSED', clockedOutAt: new Date(), clockedOutById: context.userId, clockOutReason: reason },
      });
      if (!result.count) throw new ConflictException('This attendance record was already closed');
      await this.audit.record(context, correcting ? 'attendance.corrected-clock-out' : 'attendance.clocked-out', 'StaffAttendance', record.id, { storeId, userId: targetUserId, reason }, tx);
      return tx.staffAttendance.findUniqueOrThrow({ where: { id: record.id } });
    });
    return { id: updated.id, userId: updated.userId, storeId, status: updated.status, clockedOutAt: updated.clockedOutAt, reason: updated.clockOutReason };
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
    const settings = await this.orgSettings(context.organizationId, storeId);
    const ttlHours = Number.isFinite(Number(settings.holdTtlHours)) && Number(settings.holdTtlHours) > 0 ? Math.min(720, Number(settings.holdTtlHours)) : 24;
    try {
      const held = await this.prisma.heldSale.create({
        data: {
          organizationId: context.organizationId,
          storeId,
          registerId,
          clientHoldId: clientHoldId ?? randomUUID(),
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          createdById: context.userId,
          expiresAt: new Date(Date.now() + ttlHours * 3_600_000),
        },
      });
      return { id: held.id, clientHoldId: held.clientHoldId, payload: held.payload, createdAt: held.createdAt, expiresAt: held.expiresAt };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A held sale with this clientHoldId already exists');
      throw error;
    }
  }

  /** Active holds only: a hold past its expiry time is not offered for resume. */
  async listHeldSales(context: UserContext, storeId?: string) {
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store) {
      this.authorization.assertStoreAccess(context, store);
      this.authorization.assertPermissions(context, ['sale.hold'], store);
    }
    const permitted = store ? [store] : await this.authorization.permittedStoreIds(context, 'sale.hold');
    const holds = await this.prisma.heldSale.findMany({
      where: { organizationId: context.organizationId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], ...(permitted ? { storeId: { in: permitted } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return holds.map((held) => ({ id: held.id, clientHoldId: held.clientHoldId, registerId: held.registerId, payload: held.payload, createdAt: held.createdAt, expiresAt: held.expiresAt }));
  }

  async resumeHold(context: UserContext, holdId: string) {
    const held = await this.prisma.heldSale.findFirst({ where: { id: uuid(holdId, 'holdId'), organizationId: context.organizationId } });
    if (!held) throw new NotFoundException('Held sale not found');
    this.authorization.assertStoreAccess(context, held.storeId);
    this.authorization.assertPermissions(context, ['sale.hold'], held.storeId);
    if (held.expiresAt && held.expiresAt.getTime() <= Date.now()) throw new GoneException('This held sale has expired. Start a new sale.');
    // Deleting by id is the claim: only one concurrent resume can succeed.
    const deleted = await this.prisma.heldSale.deleteMany({ where: { id: held.id } });
    if (deleted.count === 0) throw new ConflictException('Held sale was already resumed');
    return { id: held.id, payload: held.payload };
  }

  // ───────────── Checkout ─────────────

  async checkoutConfig(context: UserContext, requestedStoreId: string) {
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['sale.create'], storeId);
    const [settings, handlers, discountReasons] = await Promise.all([
      this.orgSettings(context.organizationId, storeId),
      this.eligibleSaleHandlers(context, storeId),
      this.prisma.discountReason.findMany({
        where: { organizationId: context.organizationId, storeId, status: 'ACTIVE' },
        select: { code: true, name: true },
        orderBy: { name: 'asc' },
        take: 100,
      }),
    ]);
    const fields = cleanFieldSet(settings.checkoutFields, 'CHECKOUT');
    const productFields = cleanFieldSet(settings.productFields);
    return {
      fields: fields.fields,
      coreFields: fields.coreFields,
      requireBillHandler: settings.requireBillHandler === true,
      requireDiscountReasonCode: settings.requireDiscountReasonCode === true,
      discountReasons,
      discounts: {
        lineEnabled: settings.lineDiscountEnabled === true,
        lineMaxPercent: Number(settings.lineDiscountMaxPercent ?? 100),
        billEnabled: settings.billDiscountEnabled === true,
        billMaxPercent: Number(settings.billDiscountMaxPercent ?? 100),
        allowStacking: settings.allowDiscountStacking === true,
      },
      handlers: handlers.map(({ id, firstName, lastName }) => ({ id, name: `${firstName} ${lastName}`.trim() })),
      productFields: productFields.fields.filter((field) => field.showInList),
      productCoreFields: productFields.coreFields,
    };
  }

  private async eligibleSaleHandlers(context: UserContext, storeId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: context.organizationId, status: 'ACTIVE', stores: { some: { storeId } } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 500,
    });
    const eligible = await Promise.all(users.map(async (user) => {
      const target = await this.authorization.getUserContext(user.id);
      return this.authorization.hasPermission(target, 'sale.create', storeId) ? user : null;
    }));
    const result = eligible.filter((user): user is NonNullable<typeof user> => user !== null);
    if (!result.some((user) => user.id === context.userId) && this.authorization.hasPermission(context, 'sale.create', storeId)) {
      result.unshift({ id: context.userId, firstName: context.displayName, lastName: '' });
    }
    return result;
  }

  async completeSale(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId ?? context.defaultStoreId, 'storeId');
    const registerId = uuid(input.registerId, 'registerId');
    const sessionId = uuid(input.sessionId, 'sessionId');
    const clientSaleId = optionalString(input.clientSaleId) || randomUUID();
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['sale.create'], storeId);

    // Return an already completed bill before validating today's fields or staff assignment. A retry
    // must remain idempotent even if the store has since changed its checkout configuration.
    const existing = await this.findSaleByClientId(context.organizationId, clientSaleId);
    if (existing) {
      if (existing.storeId !== storeId) throw new NotFoundException('Sale not found');
      return this.saleResult(existing);
    }

    const settingsForCheckout = await this.orgSettings(context.organizationId, storeId);
    const fieldConfig = cleanFieldSet(settingsForCheckout.checkoutFields, 'CHECKOUT');
    const customFields = cleanFieldValues(fieldConfig.fields, input.customFields);
    const handledById = input.handledById ? uuid(input.handledById, 'handledById') : context.userId;
    if (settingsForCheckout.requireBillHandler === true && !input.handledById) throw new BadRequestException('Select who handled this bill');
    const eligibleHandlers = await this.eligibleSaleHandlers(context, storeId);
    if (!eligibleHandlers.some((user) => user.id === handledById)) throw new BadRequestException('The selected bill handler is not an active cashier for this store');
    const handledBy = eligibleHandlers.find((user) => user.id === handledById)!;
    const checkoutFieldSnapshot = fieldConfig.fields.flatMap((field) => customFields[field.key] === undefined ? [] : [{ key: field.key, label: field.label, type: field.type, showOnReceipt: field.showOnReceipt, value: customFields[field.key] }]);

    const session = await this.openSessionRow(context, sessionId);
    if (session.storeId !== storeId || session.registerId !== registerId) {
      throw new BadRequestException('Session does not belong to this register and store');
    }
    const rawLines = Array.isArray(input.lines) ? input.lines as LineInput[] : [];
    if (!rawLines.length) throw new BadRequestException('At least one sale line is required');
    const priced = await this.priceCart(context, storeId, input);
    const { lines, subtotal, lineDiscount, discount, tax, chargePlan, total, customer, promotions } = priced;

    // "Total frozen": if the screen was priced differently, show the cashier the new figure instead of charging a surprise.
    if (typeof input.quoteHash === 'string' && input.quoteHash && input.quoteHash !== priced.quoteHash) {
      throw new ConflictException({ code: 'PRICE_CHANGED', message: 'The price changed while this bill was open. Check the new total.', quote: priced.quote });
    }

    const { settings, currency } = priced;
    const requestedDiscount = lineDiscount + priced.manualOrderDiscount;
    const discountReason = await this.discountReasonText(context, storeId, input, lines, settings, requestedDiscount);
    const discountAuthorization = await this.assertDiscountAllowed(context, storeId, requestedDiscount, subtotal + lineDiscount, clientSaleId, input.approvalId, input.managerPin);
    const managerApprovalUserId = discountAuthorization?.approvedById ?? null;
    const openPriceLines = lines.filter((line) => line.openPrice);
    const openPriceManagerId = openPriceLines.length
      ? await this.verifyManagerPin(context, storeId, input.managerPin, 'OPEN_PRICE', 'Open-price items need manager approval')
      : null;

    const paymentPlan = await this.paymentPlan(context, storeId, input.payments, total, customer, settings);
    if (paymentPlan.appliedTotalCents !== paymentPlan.roundedTotalCents) throw new BadRequestException(`Payment total must equal ${formatMinor(paymentPlan.roundedTotalCents, currency)}`);

    const snapshot: JsonObject = await this.documentSnapshot(context, storeId, customer, settings);
    snapshot.checkoutFields = checkoutFieldSnapshot;
    snapshot.checkoutFieldsVersion = fieldConfig.version;
    snapshot.billHandler = `${handledBy.firstName} ${handledBy.lastName}`.trim();
    const attemptIds = paymentPlan.payments.flatMap((payment) => (payment.attemptId ? [payment.attemptId] : []));

    try {
      const saleId = await this.prisma.$transaction(async (tx) => {
        if (discountAuthorization?.tokenId) await this.consumeApprovalToken(tx, context, discountAuthorization.tokenId, 'SALE_DISCOUNT', storeId, clientSaleId, { discountCents: requestedDiscount, subtotalCents: subtotal + lineDiscount });
        const location = await this.storeLocation(tx, context.organizationId, storeId);
        if (location) {
          const policy = await this.negativeStockPolicy(tx, context.organizationId, storeId);
          for (const line of lines) {
            const balance = await tx.inventoryBalance.findUnique({ where: { locationId_variantId_status: { locationId: location.id, variantId: line.variantId, status: 'SELLABLE' } }, select: { quantity: true } });
            const available = balance ? num(balance.quantity) : 0;
            if (available - line.quantity < 0) {
              if (policy === 'BLOCK') throw new BadRequestException(`Insufficient stock for ${line.sku}`);
              if (policy === 'WARN') await this.raiseAlert(tx, context, 'NEGATIVE_STOCK', 'HIGH', `Sale would make ${line.sku} negative (${Math.round((available - line.quantity) * 1000) / 1000} units)`, clientSaleId, storeId);
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
            promotions: promotions.applied as unknown as Prisma.InputJsonValue,
            documentSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            customFields: customFields as Prisma.InputJsonObject,
            handledById,
            roundingCents: paymentPlan.roundingCents,
            totalCents: total,
            notes: [optionalString(input.notes), discountReason ? `Discount reason: ${discountReason}` : undefined].filter(Boolean).join(' | '),
            customerId: customer?.id ?? null,
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

        // A promotion with a usage limit is claimed atomically: if another till used the last one, this sale is refused.
        for (const applied of promotions.applied) {
          const claimed = await tx.$executeRaw`UPDATE promotions SET usage_count = usage_count + 1 WHERE id = ${applied.promotionId}::uuid AND (usage_limit IS NULL OR usage_count < usage_limit)`;
          if (claimed === 0) throw new ConflictException({ code: 'PROMOTION_LIMIT_REACHED', message: `Promotion ${applied.code} has just been used up. Check the new total.` });
          await tx.promotionRedemption.create({ data: { promotionId: applied.promotionId, saleId: sale.id, customerId: customer?.id ?? null, discountCents: applied.discountCents } });
        }

        // Wallet and points are real money: debit only if the balance still covers it.
        if (customer && paymentPlan.walletCents > 0) {
          const debited = await tx.customer.updateMany({ where: { id: customer.id, walletBalanceCents: { gte: paymentPlan.walletCents } }, data: { walletBalanceCents: { decrement: paymentPlan.walletCents } } });
          if (debited.count === 0) throw new BadRequestException('Insufficient wallet balance');
          await tx.customerLedger.create({ data: { customerId: customer.id, type: 'DEBIT', amountCents: -paymentPlan.walletCents, points: 0, referenceId: sale.id } });
        }
        if (customer && paymentPlan.pointsUsed > 0) {
          const debited = await tx.customer.updateMany({ where: { id: customer.id, pointsBalance: { gte: paymentPlan.pointsUsed } }, data: { pointsBalance: { decrement: paymentPlan.pointsUsed } } });
          if (debited.count === 0) throw new BadRequestException('Insufficient points balance');
          await tx.customerLedger.create({ data: { customerId: customer.id, type: 'POINTS_REDEEM', amountCents: 0, points: -paymentPlan.pointsUsed, referenceId: sale.id } });
        }

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
        if (customer) await this.earnPoints(tx, customer.id, total, sale.id);
        if (total <= 0 && subtotal + lineDiscount > 0) {
          await this.raiseAlert(tx, context, 'ZERO_TOTAL', 'MEDIUM', `Sale ${receiptNumber} totals zero after discounts`, sale.id, storeId);
        }
        if (managerApprovalUserId && !discountAuthorization?.tokenId) {
          await tx.approval.create({ data: {
            organizationId: context.organizationId,
            storeId,
            action: 'SALE_DISCOUNT',
            referenceId: sale.id,
            requestedById: context.userId,
            approvedById: managerApprovalUserId,
            reason: discountReason || 'Manager PIN approval',
            status: 'APPROVED',
            decidedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: new Date(),
            payloadHash: this.approvalPayloadHash('SALE_DISCOUNT', storeId, sale.id, { discountCents: requestedDiscount, subtotalCents: subtotal + lineDiscount }),
          } });
        }
        if (openPriceManagerId) {
          await tx.approval.create({ data: {
            organizationId: context.organizationId,
            storeId,
            action: 'OPEN_PRICE',
            referenceId: sale.id,
            requestedById: context.userId,
            approvedById: openPriceManagerId,
            reason: `Open price: ${openPriceLines.map((line) => `${line.sku} @ ${formatMinor(line.unitPriceCents, currency)}`).join(', ')}`,
            status: 'APPROVED',
            decidedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            consumedAt: new Date(),
            payloadHash: this.approvalPayloadHash('OPEN_PRICE', storeId, sale.id, { lines: openPriceLines.map((line) => ({ sku: line.sku, priceCents: line.unitPriceCents })) }),
          } });
        }
        await this.flagClosedDayForRestatement(tx, context, storeId, sale.createdAt);
        await this.audit.record(context, 'sale.completed', 'Sale', sale.id, { receiptNumber, total, clientSaleId, managerApprovalUserId, openPriceManagerId, promotions: promotions.applied.map((entry) => entry.code) }, tx);
        return sale.id;
      });
      return this.saleResult(await this.findSaleOrThrow(context.organizationId, saleId));
    } catch (error) {
      // A concurrent request with the same clientSaleId (or a commit we could not confirm) may have saved the sale.
      const winner = await this.findSaleByClientId(context.organizationId, clientSaleId);
      if (winner?.storeId === storeId) return this.saleResult(winner);
      // Money was captured but the sale was not saved: put it back, and alert someone if that fails too.
      await this.payments.reverseAfterFailedSale(context, attemptIds, 'Sale could not be saved');
      if (isUniqueViolation(error)) throw new ConflictException('This payment or receipt number was already used. Check the bill and try again.');
      throw error;
    }
  }

  async listSales(context: UserContext, storeId?: string, from?: string, to?: string, receipt?: string, customer?: string) {
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    if (store) {
      this.authorization.assertStoreAccess(context, store);
      this.authorization.assertPermissions(context, ['sale.view'], store);
    }
    const reachable = store ? [store] : await this.authorization.permittedStoreIds(context, 'sale.view');
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
        handledBy: { select: { firstName: true, lastName: true } },
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
      cashier: `${sale.handledBy?.firstName ?? sale.createdBy.firstName} ${sale.handledBy?.lastName ?? sale.createdBy.lastName}`.trim(),
      createdBy: `${sale.createdBy.firstName} ${sale.createdBy.lastName}`.trim(),
      customFields: objectField(sale.customFields),
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
        handledBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    this.authorization.assertStoreAccess(context, sale.storeId);
    this.authorization.assertPermissions(context, ['sale.view'], sale.storeId);
    const receiptFooter = (await this.orgSettings(context.organizationId, sale.storeId)).receiptFooter;
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
      chargeCents: sale.chargeCents,
      charges: Array.isArray(sale.charges) ? sale.charges : [],
      promotions: Array.isArray(sale.promotions) ? sale.promotions : [],
      buyer: (sale.documentSnapshot as { buyer?: unknown } | null)?.buyer ?? null,
      placeOfSupply: (sale.documentSnapshot as { placeOfSupply?: unknown } | null)?.placeOfSupply ?? null,
      totalCents: sale.totalCents,
      createdAt: sale.createdAt,
      cashier: `${sale.handledBy?.firstName ?? sale.createdBy.firstName} ${sale.handledBy?.lastName ?? sale.createdBy.lastName}`.trim(),
      createdBy: `${sale.createdBy.firstName} ${sale.createdBy.lastName}`.trim(),
      customFields: objectField(sale.customFields),
      checkoutFields: Array.isArray((sale.documentSnapshot as { checkoutFields?: unknown } | null)?.checkoutFields) ? (sale.documentSnapshot as { checkoutFields: unknown[] }).checkoutFields : [],
      register: sale.register.name || sale.register.code,
      lines: sale.lines.map((line) => ({ ...line, quantity: num(line.quantity) })),
      payments: sale.payments,
      returns: sale.returns.map((value) => ({ id: value.id, creditNoteNumber: value.creditNoteNumber, totalCents: value.totalCents, createdAt: value.createdAt, reason: value.reason })),
    };
  }

  /** GST tax invoice for a sale as a PDF. Uses the details frozen at sale time, so a reprint is identical to the original. */
  async invoicePdf(context: UserContext, saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: uuid(saleId, 'saleId'), organizationId: context.organizationId },
      include: {
        lines: true,
        payments: true,
        customer: { select: { name: true, phone: true, isBusiness: true, legalName: true, taxNumber: true, billingAddress: true, stateCode: true } },
        register: { select: { code: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        handledBy: { select: { firstName: true, lastName: true } },
        store: { select: { name: true, code: true, address: true, timezone: true, taxNumber: true } },
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');
    this.authorization.assertStoreAccess(context, sale.storeId);
    this.authorization.assertPermissions(context, ['sale.view'], sale.storeId);
    type Snapshot = { seller: { name: string; address: string; taxNumber: string; stateCode: string; storeName: string; storeCode: string; storeAddress: string; timezone: string }; buyer: { name: string; phone: string; isBusiness: boolean; legalName: string; taxNumber: string; address: string; stateCode: string } | null; placeOfSupply: { stateCode: string; stateName: string; intraState: boolean }; footer: string; billHandler?: string; checkoutFields?: { key: string; label: string; type: string; value: string | number | boolean; showOnReceipt?: boolean }[] };
    let snapshot = sale.documentSnapshot as Snapshot | null;
    if (!snapshot) {
      // Sales made before invoices were frozen: build the same shape from today's details.
      const [organization, settings] = await Promise.all([
        this.prisma.organization.findUnique({ where: { id: context.organizationId }, select: { name: true, legalName: true, tradeName: true, address: true, gstin: true } }),
        this.orgSettings(context.organizationId, sale.storeId),
      ]);
      const taxNumber = sale.store.taxNumber || organization?.gstin || '';
      const sellerState = gstinStateCode(taxNumber);
      const buyerState = sale.customer ? sale.customer.stateCode || gstinStateCode(sale.customer.taxNumber) : '';
      snapshot = {
        seller: { name: organization?.legalName || organization?.tradeName || organization?.name || 'Invoice', address: organization?.address ?? '', taxNumber, stateCode: sellerState, storeName: sale.store.name, storeCode: sale.store.code, storeAddress: sale.store.address, timezone: sale.store.timezone },
        buyer: sale.customer ? { name: sale.customer.name, phone: sale.customer.phone, isBusiness: sale.customer.isBusiness, legalName: sale.customer.legalName, taxNumber: sale.customer.taxNumber, address: sale.customer.billingAddress, stateCode: buyerState } : null,
        placeOfSupply: { stateCode: buyerState || sellerState, stateName: GST_STATES[buyerState || sellerState] ?? '', intraState: isIntraState(sellerState, buyerState) },
        footer: typeof settings.receiptFooter === 'string' ? settings.receiptFooter : '',
      };
    }
    const charges = (Array.isArray(sale.charges) ? sale.charges : []) as { name: string; amountCents: number; taxCents: number; taxRateBps: number }[];
    const buffer = buildInvoicePdf({
      currency: (sale.documentSnapshot as { currency?: string } | null)?.currency ?? currencyFromSettings(await this.orgSettings(context.organizationId)),
      invoiceNumber: sale.receiptNumber,
      issuedAt: sale.createdAt,
      timezone: snapshot.seller.timezone || sale.store.timezone,
      status: sale.status,
      seller: { name: snapshot.seller.name, address: snapshot.seller.address, gstin: snapshot.seller.taxNumber, storeName: snapshot.seller.storeName, storeCode: snapshot.seller.storeCode, storeAddress: snapshot.seller.storeAddress },
      customer: snapshot.buyer ? { name: snapshot.buyer.name, phone: snapshot.buyer.phone ?? '' } : null,
      buyer: snapshot.buyer ? { legalName: snapshot.buyer.legalName, taxNumber: snapshot.buyer.taxNumber, address: snapshot.buyer.address, isBusiness: snapshot.buyer.isBusiness } : null,
      placeOfSupply: snapshot.placeOfSupply,
      cashier: `${sale.createdBy.firstName} ${sale.createdBy.lastName}`.trim(),
      billHandler: snapshot.billHandler ?? `${sale.handledBy?.firstName ?? sale.createdBy.firstName} ${sale.handledBy?.lastName ?? sale.createdBy.lastName}`.trim(),
      customFields: (snapshot.checkoutFields ?? []).filter((field) => field.showOnReceipt === true).map((field) => ({ label: field.label, value: String(field.value) })),
      register: sale.register.name || sale.register.code,
      lines: sale.lines.map((line) => ({ name: line.name, sku: line.sku, hsnCode: line.hsnCode, quantity: num(line.quantity), unitPriceCents: line.unitPriceCents, discountCents: line.discountCents, taxRateBps: line.taxRateBps, taxCents: line.taxCents, lineTotalCents: line.lineTotalCents })),
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      charges,
      taxCents: sale.taxCents,
      roundingCents: sale.roundingCents,
      totalCents: sale.totalCents,
      payments: sale.payments.map((payment) => ({ tenderType: payment.tenderType, amountCents: payment.amountCents, reference: payment.reference })),
      footer: snapshot.footer ?? '',
    });
    return { filename: `${sale.receiptNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`, buffer };
  }

  // ───────────── Approvals ─────────────

  async requestApproval(context: UserContext, input: JsonObject) {
    const referenceId = requiredString(input.referenceId, 'referenceId');
    const storeId = uuid(input.storeId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['approval.request'], storeId);
    await this.ensureStore(context.organizationId, storeId);
    const action = oneOf(String(input.action ?? '').toUpperCase(), ['SALE_DISCOUNT', 'RETURN_REFUND', 'CASH_MOVEMENT', 'REGISTER_VARIANCE'] as const, 'action');
    if (action === 'RETURN_REFUND') {
      const exists = await this.prisma.sale.findFirst({ where: { id: referenceId, organizationId: context.organizationId, storeId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Refund approval reference was not found in this store');
    } else if (action === 'CASH_MOVEMENT' || action === 'REGISTER_VARIANCE') {
      const exists = await this.prisma.registerSession.findFirst({ where: { id: referenceId, organizationId: context.organizationId, storeId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Register approval reference was not found in this store');
    }
    const payload = objectField(input.payload);
    if (!Object.keys(payload).length) throw new BadRequestException('A payload is required so approval is bound to the requested operation');
    const reason = requiredString(input.reason ?? 'Manager approval requested', 'reason');
    const approval = await this.prisma.approval.create({
      data: {
        organizationId: context.organizationId,
        storeId,
        action,
        referenceId,
        requestedById: context.userId,
        reason,
        payloadHash: this.approvalPayloadHash(action, storeId, referenceId, payload),
        payload: payload as Prisma.InputJsonObject,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    return { id: approval.id, action: approval.action, referenceId: approval.referenceId, status: approval.status, reason: approval.reason, createdAt: approval.createdAt };
  }

  async decideApproval(context: UserContext, approvalId: string, input: JsonObject) {
    const status = oneOf(input.status, ['APPROVED', 'DENIED'] as const, 'status');
    const approval = await this.prisma.approval.findFirst({ where: { id: uuid(approvalId, 'approvalId'), organizationId: context.organizationId } });
    if (!approval) throw new NotFoundException('Approval not found');
    if (status === 'APPROVED' && approval.requestedById === context.userId) {
      await this.audit.record(context, 'approval.self-approval-rejected', 'Approval', approval.id, { action: approval.action, referenceId: approval.referenceId });
      throw new ForbiddenException('A requester cannot approve their own request');
    }
    if (approval.expiresAt ? approval.expiresAt.getTime() <= Date.now() : approval.createdAt.getTime() + 10 * 60_000 <= Date.now()) throw new ConflictException('This approval request has expired');
    if (approval.storeId) {
      this.authorization.assertStoreAccess(context, approval.storeId);
      this.authorization.assertPermissions(context, ['approval.manage'], approval.storeId);
    } else if (!context.isOrganisationAdministrator) await this.assertApprovalStoreAccess(context, approval.referenceId);
    const decided = await this.prisma.approval.updateMany({
      where: { id: approval.id, status: 'PENDING', OR: [{ expiresAt: { gt: new Date() } }, { expiresAt: null, createdAt: { gt: new Date(Date.now() - 10 * 60_000) } }] },
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
      where: { organizationId: context.organizationId, ...(store ? { storeId: store } : scopedStores ? { storeId: { in: scopedStores } } : {}) },
      include: { requestedBy: { select: { firstName: true, lastName: true } }, approvedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    let approvals = candidates;
    if (scopedStores && !store) {
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
      payload: approval.payload,
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
        include: { location: { select: { name: true } }, variant: { select: { sku: true, name: true, barcodes: { select: { code: true }, orderBy: { code: 'asc' } } } } },
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
        barcode: balance.variant.barcodes.map((barcode) => barcode.code).join(', '),
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
    const refundAuthorization = await this.assertRefundAllowed(context, sale.storeId, total, saleId, input.approvalId, input.managerPin);
    const managerApprovalUserId = refundAuthorization?.approvedById ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      if (refundAuthorization?.tokenId) await this.consumeApprovalToken(tx, context, refundAuthorization.tokenId, 'RETURN_REFUND', sale.storeId, saleId, { totalCents: total });
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
      if (managerApprovalUserId && !refundAuthorization?.tokenId) {
        await tx.approval.create({ data: {
          organizationId: context.organizationId,
          storeId: sale.storeId,
          action: 'RETURN_REFUND',
          referenceId: created.id,
          requestedById: context.userId,
          approvedById: managerApprovalUserId,
          reason,
          status: 'APPROVED',
          decidedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          consumedAt: new Date(),
          payloadHash: this.approvalPayloadHash('RETURN_REFUND', sale.storeId, saleId, { totalCents: total }),
        } });
      }
      await this.flagClosedDayForRestatement(tx, context, sale.storeId, created.createdAt);
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
      this.authorization.assertPermissions(context, ['refund.view'], store);
    }
    const accessible = store ? [store] : await this.authorization.permittedStoreIds(context, 'refund.view');
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
    this.authorization.assertPermissions(context, ['refund.view'], value.storeId);
    return { ...value, originalSale: { ...value.originalSale, lines: value.originalSale.lines.map((line) => ({ ...line, quantity: num(line.quantity) })) }, lines: value.lines.map((line) => ({ ...line, quantity: num(line.quantity) })) };
  }

  // ───────────── Reporting & alerts ─────────────

  async listDayCloses(context: UserContext, storeIdInput: string) {
    const storeId = uuid(storeIdInput, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['report.view'], storeId);
    const rows = await this.prisma.storeDayClose.findMany({
      where: { organizationId: context.organizationId, storeId },
      include: { closedBy: { select: { firstName: true, lastName: true } }, revisions: { orderBy: { version: 'desc' }, take: 10 } },
      orderBy: { businessDate: 'desc' },
      take: 90,
    });
    return rows.map((row) => ({
      id: row.id, storeId: row.storeId, businessDate: row.businessDate.toISOString().slice(0, 10),
      version: row.version, status: row.status, snapshot: row.snapshot, closeReason: row.closeReason,
      closedAt: row.closedAt, closedBy: `${row.closedBy.firstName} ${row.closedBy.lastName}`.trim(),
      revisions: row.revisions.map((revision) => ({ version: revision.version, reason: revision.reason, createdAt: revision.createdAt })),
    }));
  }

  async closeStoreDay(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    const dateText = requiredString(input.businessDate, 'businessDate');
    const businessDate = this.dayBoundary(dateText, 'businessDate', false);
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['dayclose.manage'], storeId);
    const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId: context.organizationId }, select: { id: true, timezone: true } });
    if (!store) throw new NotFoundException('Store not found');
    const reason = optionalString(input.reason)?.trim() ?? '';
    const forceClose = input.forceClose === true;
    const existing = await this.prisma.storeDayClose.findUnique({ where: { storeId_businessDate: { storeId, businessDate } } });
    const restate = input.restate === true || existing?.status === 'RESTATEMENT_REQUIRED';
    if (existing && !restate) return { id: existing.id, businessDate: dateText, version: existing.version, status: existing.status, snapshot: existing.snapshot, idempotent: true };
    if (restate && !reason) throw new BadRequestException('A reason is required when restating a closed business day');
    if (forceClose && !reason) throw new BadRequestException('A reason is required when force-closing open registers');
    const range = this.localDayBounds(dateText, store.timezone);

    return this.prisma.$transaction(async (tx) => {
      const openSessions = await tx.registerSession.findMany({
        where: { organizationId: context.organizationId, storeId, status: 'OPEN' },
        select: { id: true, expectedCashCents: true },
      });
      if (openSessions.length && !forceClose) throw new ConflictException({ message: 'Close all open registers before closing the business day', openSessionIds: openSessions.map((session) => session.id) });
      if (openSessions.length) {
        this.authorization.assertPermissions(context, ['register.close'], storeId);
        for (const session of openSessions) {
          const result = await tx.registerSession.updateMany({
            where: { id: session.id, status: 'OPEN', expectedCashCents: session.expectedCashCents },
            data: { status: 'CLOSED', countedCashCents: session.expectedCashCents, varianceCents: 0, closedAt: new Date(), closedById: context.userId, closeReason: reason, forcedClosed: true },
          });
          if (!result.count) throw new ConflictException('A register changed while the business day was closing; retry the close');
          await tx.alert.updateMany({ where: { organizationId: context.organizationId, type: 'REGISTER_NOT_CLOSED', referenceId: session.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: context.userId, resolutionNote: `Force-closed during day close: ${reason}`, activeDedupeKey: null } });
          await this.audit.record(context, 'register-session.force-closed', 'RegisterSession', session.id, { reason, countedCashCents: session.expectedCashCents, source: 'day-close' }, tx);
        }
      }

      const sales = await tx.sale.findMany({
        where: { organizationId: context.organizationId, storeId, status: 'COMPLETED', createdAt: { gte: range.from, lt: range.to } },
        select: { id: true, totalCents: true, taxCents: true, discountCents: true },
        orderBy: { id: 'asc' },
      });
      const returns = await tx.saleReturn.findMany({
        where: { organizationId: context.organizationId, storeId, createdAt: { gte: range.from, lt: range.to } },
        select: { id: true, totalCents: true }, orderBy: { id: 'asc' },
      });
      const [payments, closedSessions] = await Promise.all([
        tx.salePayment.groupBy({ by: ['tenderType'], where: { saleId: { in: sales.map((sale) => sale.id) } }, _sum: { amountCents: true } }),
        tx.registerSession.findMany({ where: { organizationId: context.organizationId, storeId, closedAt: { gte: range.from, lt: range.to } }, select: { id: true, expectedCashCents: true, countedCashCents: true, varianceCents: true, forcedClosed: true } }),
      ]);
      const snapshot: Prisma.InputJsonObject = {
        businessDate: dateText, timezone: store.timezone, periodStart: range.from.toISOString(), periodEnd: range.to.toISOString(), asOf: new Date().toISOString(),
        salesCount: sales.length, salesTotalCents: sales.reduce((sum, sale) => sum + sale.totalCents, 0), taxCents: sales.reduce((sum, sale) => sum + sale.taxCents, 0), discountCents: sales.reduce((sum, sale) => sum + sale.discountCents, 0),
        returnsCount: returns.length, returnsTotalCents: returns.reduce((sum, value) => sum + value.totalCents, 0),
        tenders: payments.map((payment) => ({ tenderType: payment.tenderType, amountCents: payment._sum.amountCents ?? 0 })),
        registerCount: closedSessions.length, cashVarianceCents: closedSessions.reduce((sum, session) => sum + (session.varianceCents ?? 0), 0), forcedCloseCount: closedSessions.filter((session) => session.forcedClosed).length,
        saleIds: sales.map((sale) => sale.id), returnIds: returns.map((value) => value.id),
        registerSessions: closedSessions.map((session) => ({ id: session.id, expectedCashCents: session.expectedCashCents, countedCashCents: session.countedCashCents, varianceCents: session.varianceCents, forcedClosed: session.forcedClosed })),
      };
      let record;
      if (existing) {
        await tx.dayCloseRevision.create({ data: { organizationId: context.organizationId, dayCloseId: existing.id, version: existing.version, snapshot: existing.snapshot as Prisma.InputJsonValue, reason, createdById: context.userId } });
        record = await tx.storeDayClose.update({ where: { id: existing.id }, data: { version: { increment: 1 }, status: 'CLOSED', snapshot, closeReason: reason, closedById: context.userId, closedAt: new Date() } });
      } else {
        record = await tx.storeDayClose.create({ data: { organizationId: context.organizationId, storeId, businessDate, snapshot, closeReason: reason, closedById: context.userId } });
      }
      await this.audit.record(context, existing ? 'day-close.restated' : 'day-close.completed', 'StoreDayClose', record.id, { storeId, businessDate: dateText, version: record.version, reason, forceClosedSessions: openSessions.length }, tx);
      return { id: record.id, businessDate: dateText, version: record.version, status: record.status, snapshot: record.snapshot, closedAt: record.closedAt };
    });
  }

  async createReportExport(context: UserContext, input: JsonObject) {
    const format = oneOf(input.format ?? 'CSV', ['CSV', 'PDF'] as const, 'format');
    const storeId = input.storeId ? uuid(input.storeId, 'storeId') : null;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['report.export'], storeId);
    } else if (!context.isOrganisationAdministrator) {
      const stores = await this.authorization.permittedStoreIds(context, 'report.export');
      if (!this.authorization.hasPermission(context, 'report.export') && !stores?.length) throw new ForbiddenException('No store scope is available for report export');
    }
    const filters: Prisma.InputJsonObject = {
      ...(storeId ? { storeId } : {}),
      ...(typeof input.from === 'string' ? { from: input.from } : {}),
      ...(typeof input.to === 'string' ? { to: input.to } : {}),
      ...(typeof input.registerId === 'string' ? { registerId: input.registerId } : {}),
      ...(typeof input.cashierId === 'string' ? { cashierId: input.cashierId } : {}),
    };
    const job = await this.prisma.reportExportJob.create({ data: { organizationId: context.organizationId, storeId, requestedById: context.userId, format, filters, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await this.audit.record(context, 'report-export.queued', 'ReportExportJob', job.id, { format, storeId, filters });
    return { id: job.id, status: job.status, format: job.format, createdAt: job.createdAt, expiresAt: job.expiresAt };
  }

  async getReportExport(context: UserContext, jobIdInput: string) {
    const job = await this.findReportExport(context, jobIdInput);
    return { id: job.id, status: job.status, format: job.format, errorMessage: job.errorMessage, attempts: job.attempts, createdAt: job.createdAt, completedAt: job.completedAt, expiresAt: job.expiresAt };
  }

  async retryReportExport(context: UserContext, jobIdInput: string) {
    const job = await this.findReportExport(context, jobIdInput);
    if (job.status !== 'FAILED') throw new ConflictException('Only failed report exports can be retried');
    await this.prisma.reportExportJob.update({ where: { id: job.id }, data: { status: 'QUEUED', errorMessage: '', resultData: null, startedAt: null, completedAt: null, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await this.audit.record(context, 'report-export.retried', 'ReportExportJob', job.id, { format: job.format });
    return { id: job.id, status: 'QUEUED', format: job.format, expiresAt: new Date(Date.now() + 7 * 86_400_000) };
  }

  async downloadReportExport(context: UserContext, jobIdInput: string) {
    const job = await this.findReportExport(context, jobIdInput);
    if (job.expiresAt.getTime() <= Date.now()) throw new GoneException('This report export has expired');
    if (job.status !== 'READY' || !job.resultData) throw new ConflictException('The report export is not ready to download');
    await this.audit.record(context, 'report-export.downloaded', 'ReportExportJob', job.id, { format: job.format });
    return { contentType: job.format === 'PDF' ? 'application/pdf' : 'text/csv; charset=utf-8', filename: `pos-report-${job.id}.${job.format.toLowerCase()}`, buffer: Buffer.from(job.resultData) };
  }

  /** Invoked by the scheduled worker; permissions are reloaded for each job before generation. */
  async processReportExportJobs() {
    const expired = await this.prisma.reportExportJob.updateMany({ where: { status: 'READY', expiresAt: { lte: new Date() }, resultData: { not: null } }, data: { resultData: null } });
    const queued = await this.prisma.reportExportJob.findMany({ where: { status: 'QUEUED', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' }, take: 5 });
    let processed = 0;
    for (const job of queued) {
      const claimed = await this.prisma.reportExportJob.updateMany({ where: { id: job.id, status: 'QUEUED' }, data: { status: 'PROCESSING', startedAt: new Date(), attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      try {
        const context = await this.authorization.getUserContext(job.requestedById);
        const filters = job.filters as JsonObject;
        const report = await this.reports(context, optionalString(filters.from), optionalString(filters.to), job.storeId ?? undefined, optionalString(filters.registerId), optionalString(filters.cashierId));
        // CSV remains the single report serialization contract; PDF wraps the same rows in a readable document.
        const csv = await this.reportCsv(context, optionalString(filters.from), optionalString(filters.to), job.storeId ?? undefined, optionalString(filters.registerId), optionalString(filters.cashierId));
        const bytes = job.format === 'CSV'
          ? Buffer.from(csv, 'utf8')
          : buildReportPdf(`POS report · ${job.storeId ?? 'all permitted stores'}`, [
            `Period: ${report.period.from} to ${report.period.to} | As of: ${new Date().toISOString()}`,
            '', ...csv.trimEnd().split('\n').map((line) => line.replaceAll(',', ' | ').replaceAll('"', '')),
          ]);
        await this.prisma.$transaction(async (tx) => {
          await tx.reportExportJob.update({ where: { id: job.id }, data: { status: 'READY', resultData: new Uint8Array(bytes), errorMessage: '', completedAt: new Date() } });
          await this.audit.record(context, 'report-export.completed', 'ReportExportJob', job.id, { format: job.format, bytes: bytes.length }, tx);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : 'Report export failed';
        await this.prisma.reportExportJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorMessage: message, completedAt: new Date() } });
      }
      processed += 1;
    }
    return { processed, expiredArtifactsCleared: expired.count };
  }

  private async findReportExport(context: UserContext, idInput: string) {
    const job = await this.prisma.reportExportJob.findFirst({ where: { id: uuid(idInput, 'jobId'), organizationId: context.organizationId } });
    if (!job) throw new NotFoundException('Report export not found');
    if (job.storeId) {
      this.authorization.assertStoreAccess(context, job.storeId);
      this.authorization.assertPermissions(context, ['report.export'], job.storeId);
    } else if (!context.isOrganisationAdministrator) {
      if (job.requestedById !== context.userId) throw new ForbiddenException('You cannot access this report export');
      const stores = await this.authorization.permittedStoreIds(context, 'report.export');
      if (!this.authorization.hasPermission(context, 'report.export') && !stores?.length) throw new ForbiddenException('Report export permission was removed');
    }
    return job;
  }

  private async flagClosedDayForRestatement(tx: Tx, context: UserContext, storeId: string, occurredAt: Date) {
    const store = await tx.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
    if (!store) return;
    const day = this.localDate(occurredAt, store.timezone);
    const businessDate = this.dayBoundary(day, 'businessDate', false);
    const closed = await tx.storeDayClose.findUnique({ where: { storeId_businessDate: { storeId, businessDate } }, select: { id: true, status: true } });
    if (!closed || closed.status === 'RESTATEMENT_REQUIRED') return;
    await tx.storeDayClose.update({ where: { id: closed.id }, data: { status: 'RESTATEMENT_REQUIRED' } });
    await this.audit.record(context, 'day-close.restatement-required', 'StoreDayClose', closed.id, { eventAt: occurredAt.toISOString(), source: 'late-operational-event' }, tx);
  }

  async reports(context: UserContext, from?: string, to?: string, storeId?: string, registerId?: string, cashierId?: string) {
    const orgId = context.organizationId;
    const store = storeId ? uuid(storeId, 'storeId') : undefined;
    const storeRecord = store ? await this.prisma.store.findFirst({ where: { id: store, organizationId: orgId }, select: { id: true, timezone: true } }) : null;
    const zone = storeRecord?.timezone ?? 'UTC';
    const start = from ? (storeRecord ? this.localDayBounds(from, zone).from : this.dayBoundary(from, 'from', false)) : new Date(Date.now() - 30 * 86_400_000);
    const end = to ? (storeRecord ? new Date(this.localDayBounds(to, zone).to.getTime() - 1) : this.dayBoundary(to, 'to', true)) : new Date();
    const period = { gte: start, lte: end };
    if (store) {
      if (!storeRecord) throw new NotFoundException('Store not found');
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
      ...(cashier ? { OR: [{ handledById: cashier }, { handledById: null, createdById: cashier }] } : {}),
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
          include: { register: { select: { name: true, code: true } }, openedBy: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

    const trend = new Map<string, { sales: number; transactions: number }>();
    const byHour = new Map<number, { sales: number; transactions: number }>();
    const gst = new Map<string, { hsnCode: string; rateBps: number; taxableCents: number; taxCents: number; grossCents: number }>();
    let itemCount = 0;
    let costCents = 0;
    const now = new Date();
    const todayKey = this.localDate(now, zone);
    for (const sale of saleRows) {
      const day = this.localDate(sale.createdAt, zone);
      const dayValue = trend.get(day) ?? { sales: 0, transactions: 0 };
      dayValue.sales += sale.totalCents;
      dayValue.transactions += 1;
      trend.set(day, dayValue);
      if (day === todayKey) {
        const hourParts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(sale.createdAt);
        const hour = Number(hourParts.find((part) => part.type === 'hour')?.value ?? 0);
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
    const [todayYear, todayMonth, todayDay] = todayKey.split('-').map(Number);
    const previousWeekKey = new Date(Date.UTC(todayYear!, todayMonth! - 1, todayDay! - 7)).toISOString().slice(0, 10);
    const today = trend.get(todayKey) ?? { sales: 0, transactions: 0 };
    const previousWeek = trend.get(previousWeekKey) ?? { sales: 0, transactions: 0 };
    const tenderTotal = tenders.reduce((sum, tender) => sum + (tender._sum.amountCents ?? 0), 0);

    return {
      period: { from: start.toISOString(), to: end.toISOString() },
      asOf: now.toISOString(),
      timezone: zone,
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
        cashierId: session.openedBy.id,
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
    const canReport = store ? this.authorization.hasPermission(context, 'report.view', store) : false;
    const canReviewProducts = store ? this.authorization.hasPermission(context, 'store-catalog.verify', store) : false;
    if (store) {
      this.authorization.assertStoreAccess(context, store);
      if (!canReport && !canReviewProducts) throw new ForbiddenException('Missing permission: report.view or store-catalog.verify');
    }
    const accessibleStores = store ? [store] : await this.authorization.permittedStoreIds(context, 'report.view');
    const alerts = await this.prisma.alert.findMany({
      where: {
        organizationId: context.organizationId,
        ...(store ? { storeId: store } : accessibleStores ? { storeId: { in: accessibleStores } } : {}),
        ...(store && canReviewProducts && !canReport ? { type: 'DISTRIBUTION_PENDING' } : {}),
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
      acknowledgedAt: alert.acknowledgedAt,
      lastSeenAt: alert.lastSeenAt,
      occurrenceCount: alert.occurrenceCount,
      resolutionNote: alert.resolutionNote,
      resolvedAt: alert.resolvedAt,
    }));
  }

  async acknowledgeAlert(context: UserContext, alertId: string, input: JsonObject = {}) {
    const id = uuid(alertId, 'alertId');
    const alert = await this.prisma.alert.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.storeId) this.authorization.assertStoreAccess(context, alert.storeId);
    else if (!context.isOrganisationAdministrator) throw new ForbiddenException('Organisation alerts require organisation access');
    if (alert.storeId) this.authorization.assertPermissions(context, ['alert.manage'], alert.storeId);
    else if (!this.authorization.hasPermission(context, 'alert.manage')) throw new ForbiddenException('Missing organisation-wide permission: alert.manage');
    const resolve = input.status === 'RESOLVED';
    const note = optionalString(input.reason)?.trim() ?? '';
    if (resolve && !note) throw new BadRequestException('A resolution reason is required');
    if (input.status !== undefined && input.status !== 'ACKNOWLEDGED' && input.status !== 'RESOLVED') throw new BadRequestException('status must be ACKNOWLEDGED or RESOLVED');
    const nextStatus = resolve ? 'RESOLVED' : 'ACKNOWLEDGED';
    const changed = await this.prisma.$transaction(async (tx) => {
      const update = await tx.alert.updateMany({
        where: { id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        data: resolve
          ? { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: context.userId, resolutionNote: note, activeDedupeKey: null }
          : { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedById: context.userId },
      });
      if (!update.count) throw new ConflictException('This alert is already resolved');
      await this.audit.record(context, resolve ? 'alert.resolved' : 'alert.acknowledged', 'Alert', id, resolve ? { reason: note } : {}, tx);
      return tx.alert.findUniqueOrThrow({ where: { id }, select: { id: true, status: true } });
    });
    return { ...changed, requestedStatus: nextStatus };
  }

  // ───────────── Customers ─────────────

  async listCustomers(context: UserContext, requestedStoreId?: string) {
    const storeId = requestedStoreId ? uuid(requestedStoreId, 'storeId') : undefined;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['customer.view'], storeId);
    }
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
      isBusiness: customer.isBusiness,
      taxNumber: customer.taxNumber,
      legalName: customer.legalName,
      billingAddress: customer.billingAddress,
      stateCode: customer.stateCode,
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
      isBusiness: customer.isBusiness,
      taxNumber: customer.taxNumber,
      legalName: customer.legalName,
      billingAddress: customer.billingAddress,
      stateCode: customer.stateCode,
      createdAt: customer.createdAt,
      lifetimeSpendCents: sales.reduce((sum, sale) => sum + sale.totalCents, 0),
      sales,
      ledger,
    };
  }

  /** Business-customer identity: a valid GSTIN gives the state; without one the state may be given directly. */
  private customerIdentity(input: JsonObject, current: { isBusiness: boolean; taxNumber: string; stateCode: string } | null) {
    const taxInput = input.taxNumber === undefined ? undefined : optionalString(input.taxNumber) ?? '';
    let taxNumber = current?.taxNumber ?? '';
    let stateCode = current?.stateCode ?? '';
    if (taxInput !== undefined) {
      if (taxInput === '') { taxNumber = ''; if (input.stateCode === undefined) stateCode = ''; } else {
        const check = validateGstin(taxInput);
        if (!check.valid) throw new BadRequestException(check.error ?? 'Invalid tax number');
        taxNumber = check.normalized;
        stateCode = check.stateCode;
      }
    }
    if (input.stateCode !== undefined && !taxNumber) {
      const code = optionalString(input.stateCode) ?? '';
      if (code && !GST_STATES[code]) throw new BadRequestException(`Unknown GST state code ${code}`);
      stateCode = code;
    }
    const isBusiness = input.isBusiness === undefined ? (current?.isBusiness ?? false) || Boolean(taxNumber) : input.isBusiness === true;
    if (isBusiness && !taxNumber) throw new BadRequestException('A business customer needs a GSTIN / tax number');
    return {
      isBusiness,
      taxNumber,
      stateCode,
      ...(input.legalName !== undefined ? { legalName: optionalString(input.legalName) ?? '' } : {}),
      ...(input.billingAddress !== undefined ? { billingAddress: optionalString(input.billingAddress) ?? '' } : {}),
    };
  }

  private customerDto(customer: { id: string; name: string; phone: string; email: string; groupName: string; walletBalanceCents: number; pointsBalance: number; isBusiness: boolean; taxNumber: string; legalName: string; billingAddress: string; stateCode: string }) {
    return {
      id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, groupName: customer.groupName,
      walletBalanceCents: customer.walletBalanceCents, pointsBalance: customer.pointsBalance,
      isBusiness: customer.isBusiness, taxNumber: customer.taxNumber, legalName: customer.legalName, billingAddress: customer.billingAddress,
      stateCode: customer.stateCode, stateName: GST_STATES[customer.stateCode] ?? '',
    };
  }

  async createCustomer(context: UserContext, input: JsonObject) {
    const identity = this.customerIdentity(input, null);
    const customer = await this.prisma.customer.create({
      data: {
        organizationId: context.organizationId,
        name: requiredString(input.name, 'name'),
        phone: optionalString(input.phone) ?? '',
        email: optionalString(input.email)?.toLowerCase() ?? '',
        groupName: optionalString(input.groupName) || 'General',
        notes: optionalString(input.notes) ?? '',
        consentMarketing: input.consentMarketing === true,
        ...identity,
      },
    });
    return this.customerDto(customer);
  }

  async updateCustomer(context: UserContext, customerId: string, input: JsonObject) {
    const current = await this.prisma.customer.findFirst({ where: { id: uuid(customerId, 'customerId'), organizationId: context.organizationId } });
    if (!current) throw new NotFoundException('Customer not found');
    const identity = this.customerIdentity(input, current);
    const customer = await this.prisma.customer.update({
      where: { id: current.id },
      data: {
        ...(input.name !== undefined ? { name: requiredString(input.name, 'name') } : {}),
        ...(input.phone !== undefined ? { phone: optionalString(input.phone) ?? '' } : {}),
        ...(input.email !== undefined ? { email: optionalString(input.email)?.toLowerCase() ?? '' } : {}),
        ...(input.groupName !== undefined ? { groupName: optionalString(input.groupName) || 'General' } : {}),
        ...(input.notes !== undefined ? { notes: optionalString(input.notes) ?? '' } : {}),
        ...identity,
      },
    });
    await this.audit.record(context, 'customer.updated', 'Customer', customer.id, { changed: Object.keys(input) });
    return this.customerDto(customer);
  }

  async customerLedger(context: UserContext, customerId: string, input: JsonObject) {
    const storeId = typeof input.storeId === 'string' ? uuid(input.storeId, 'storeId') : undefined;
    if (storeId) {
      this.authorization.assertStoreAccess(context, storeId);
      this.authorization.assertPermissions(context, ['customer.manage'], storeId);
    }
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

  async listPromotions(context: UserContext, requestedStoreId?: string) {
    if (!requestedStoreId) throw new BadRequestException('storeId is required for store-owned offers');
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['pricing.view'], storeId);
    const promotions = await this.prisma.promotion.findMany({ where: { organizationId: context.organizationId, storeId }, orderBy: { code: 'asc' } });
    return promotions.map((promotion) => this.promotionDto(promotion));
  }

  async createPromotion(context: UserContext, input: JsonObject) {
    const storeId = this.authoriseScopedWrite(context, input.storeId, 'pricing.manage');
    if (!storeId) throw new BadRequestException('storeId is required for an offer');
    const type = input.type === undefined ? 'PERCENT' : oneOf(input.type, Object.values(PromotionType) as PromotionType[], 'type');
    const value = finiteNumber(input.value, 'value');
    if (value <= 0 || (type === 'PERCENT' && value > 100)) throw new BadRequestException('Promotion value is out of range');
    const startsAt = this.optionalDate(input.startsAt, 'startsAt');
    const endsAt = this.optionalDate(input.endsAt, 'endsAt');
    const scope = input.scope === undefined ? 'ALL' : oneOf(input.scope, ['ALL', 'CATEGORY', 'BRAND', 'VARIANT'] as const, 'scope');
    const scopeId = input.scopeId === undefined || input.scopeId === null ? null : uuid(input.scopeId, 'scopeId');
    if (scope !== 'ALL' && !scopeId) throw new BadRequestException('scopeId is required for a scoped offer');
    if (scopeId) {
      const found = scope === 'VARIANT'
        ? await this.prisma.productVariant.findFirst({ where: { id: scopeId, organizationId: context.organizationId }, select: { id: true } })
        : scope === 'CATEGORY'
          ? await this.prisma.category.findFirst({ where: { id: scopeId, organizationId: context.organizationId }, select: { id: true } })
          : await this.prisma.brand.findFirst({ where: { id: scopeId, organizationId: context.organizationId }, select: { id: true } });
      if (!found) throw new BadRequestException(`The ${scope.toLowerCase()} for this offer was not found`);
    }
    try {
      const promotion = await this.prisma.promotion.create({
        data: {
          organizationId: context.organizationId,
          storeId,
          code: requiredString(input.code, 'code').toUpperCase(),
          type,
          value,
          minSubtotalCents: money(input.minSubtotalCents ?? 0, 'minSubtotalCents'),
          usageLimit: input.usageLimit === undefined ? null : Math.trunc(finiteNumber(input.usageLimit, 'usageLimit')),
          perCustomerLimit: input.perCustomerLimit === undefined || input.perCustomerLimit === null ? null : Math.trunc(finiteNumber(input.perCustomerLimit, 'perCustomerLimit')),
          scope,
          scopeId: scope === 'ALL' ? null : scopeId,
          autoApply: input.autoApply === true,
          stackable: input.stackable === true,
          priority: input.priority === undefined ? 0 : Math.trunc(finiteNumber(input.priority, 'priority')),
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
        store = await tx.store.create({ data: { organizationId, code: 'MAIN', name: 'Main Store', billingSettings: DEFAULT_BILLING_SETTINGS as Prisma.InputJsonObject } });
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
        const product = await tx.product.findFirst({ where: { organizationId, name: 'Demo Coffee Mug' } })
          ?? await tx.product.create({ data: { organizationId, categoryId: category.id, name: 'Demo Coffee Mug', brand: 'Demo' } });
        variant = await tx.productVariant.create({
          data: { organizationId, productId: product.id, sku: 'MUG-BLUE', name: 'Blue', uomId: uom.id },
        });
        await tx.barcode.upsert({
          where: { organizationId_code: { organizationId, code: '890000000001' } },
          create: { organizationId, variantId: variant.id, code: '890000000001' },
          update: {},
        });
        await tx.variantPrice.create({ data: { organizationId, variantId: variant.id, amountCents: 49900, currency: currencyFromSettings(await this.orgSettings(organizationId)), includesTax: true } });
      }
      await this.ensureStoreProduct(tx, organizationId, store.id, variant.id);
      const storeTax = await tx.taxGroup.upsert({
        where: { organizationId_storeId_code: { organizationId, storeId: store.id, code: 'GST5' } },
        create: { organizationId, storeId: store.id, code: 'GST5', name: 'GST 5%', rateBps: 500 },
        update: { status: 'ACTIVE' },
      });
      await tx.storeVariant.update({ where: { storeId_variantId: { storeId: store.id, variantId: variant.id } }, data: { taxGroupId: storeTax.id } });
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

  // ───────────── Store-owned tax groups and charges ─────────────

  /** A tax group can only be used by the store that owns it. */
  private async assertTaxGroupUsable(organizationId: string, storeId: string | null, taxGroupId: string) {
    if (!storeId) throw new BadRequestException('Tax groups must be configured for a store');
    const group = await this.prisma.taxGroup.findFirst({
      where: { id: taxGroupId, organizationId, storeId, status: 'ACTIVE' },
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
    if (!requestedStoreId) throw new BadRequestException('storeId is required for store-owned tax groups');
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['catalog.view'], storeId);
    const groups = await this.prisma.taxGroup.findMany({
      where: { organizationId: context.organizationId, storeId },
      orderBy: { name: 'asc' },
    });
    return groups.map((group) => ({ id: group.id, code: group.code, name: group.name, hsnCode: group.hsnCode, ratePercent: group.rateBps / 100, includesTax: group.includesTax, storeId: group.storeId, status: group.status, scope: 'STORE' }));
  }

  /** A store creates a tax group that only it can see and use. */
  async createStoreTaxGroup(context: UserContext, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['tax.manage'], storeId);
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
      return { id: group.id, code: group.code, name: group.name, hsnCode: group.hsnCode, ratePercent, includesTax: group.includesTax, storeId, status: group.status };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('This store already has a tax group with that name');
      throw error;
    }
  }

  async updateStoreTaxGroup(context: UserContext, taxGroupId: string, input: JsonObject) {
    const storeId = uuid(input.storeId, 'storeId');
    const id = uuid(taxGroupId, 'taxGroupId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['tax.manage'], storeId);
    const current = await this.prisma.taxGroup.findFirst({ where: { id, organizationId: context.organizationId, storeId } });
    if (!current) throw new NotFoundException('Tax group not found in this store');
    const name = input.name === undefined ? undefined : requiredString(input.name, 'name');
    const ratePercent = input.ratePercent === undefined ? undefined : finiteNumber(input.ratePercent, 'ratePercent');
    if (ratePercent !== undefined && (ratePercent < 0 || ratePercent > 100)) throw new BadRequestException('GST rate must be between 0 and 100');
    const updated = await this.prisma.taxGroup.update({ where: { id }, data: {
      ...(name ? { name } : {}), ...(input.hsnCode !== undefined ? { hsnCode: optionalString(input.hsnCode) ?? '' } : {}),
      ...(ratePercent !== undefined ? { rateBps: Math.round(ratePercent * 100) } : {}),
      ...(input.includesTax !== undefined ? { includesTax: input.includesTax === true } : {}),
      ...(input.status !== undefined ? { status: oneOf(input.status, ['ACTIVE', 'DISABLED'] as const, 'status') } : {}),
    } });
    await this.audit.record(context, 'tax-group.updated', 'TaxGroup', id, { storeId, fields: Object.keys(input) }, this.prisma);
    return { id: updated.id, code: updated.code, name: updated.name, hsnCode: updated.hsnCode, ratePercent: updated.rateBps / 100, includesTax: updated.includesTax, storeId, status: updated.status };
  }

  private chargeDto(charge: { id: string; storeId: string | null; name: string; kind: 'FLAT' | 'PERCENT'; scope: 'PER_BILL' | 'PER_ITEM'; value: number; taxGroupId: string | null; status: string; taxGroup?: { name: string; rateBps: number } | null }) {
    return {
      id: charge.id, storeId: charge.storeId, scope: charge.storeId ? 'STORE' : 'ORGANISATION', name: charge.name, kind: charge.kind, applies: charge.scope,
      amountCents: charge.kind === 'FLAT' ? charge.value : null, ratePercent: charge.kind === 'PERCENT' ? charge.value / 100 : null,
      taxGroupId: charge.taxGroupId, taxGroupName: charge.taxGroup?.name ?? null, taxRatePercent: charge.taxGroup ? charge.taxGroup.rateBps / 100 : 0, status: charge.status,
    };
  }

  async listCharges(context: UserContext, requestedStoreId?: string) {
    if (!requestedStoreId) throw new BadRequestException('storeId is required for store-owned charges');
    const storeId = uuid(requestedStoreId, 'storeId');
    this.authorization.assertStoreAccess(context, storeId);
    this.authorization.assertPermissions(context, ['pricing.view'], storeId);
    const charges = await this.prisma.charge.findMany({
      where: { organizationId: context.organizationId, storeId },
      include: { taxGroup: { select: { name: true, rateBps: true } } },
      orderBy: { name: 'asc' },
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
    if (!storeId) throw new BadRequestException('Charges must be configured for a store');
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
    if (!current.storeId) throw new ForbiddenException('Organisation-wide charges are no longer configurable; create a charge in a store.');
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

  /** Active charges configured for this store. */
  private async computeCharges(organizationId: string, storeId: string, lines: PricedLine[], baseNetCents: number) {
    const charges = await this.prisma.charge.findMany({
      where: { organizationId, storeId, status: 'ACTIVE' },
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
    const priced = await this.priceCart(context, storeId, input);
    // The tenders this store offers (store setting over the organisation's), so the till shows only those.
    return { ...priced.quote, enabledTenders: this.enabledTenders(priced.settings) };
  }

  /** One calculation for the quote and the sale: price rules, line discounts, promotions, manual discount, tax, charges. */
  private async priceCart(context: UserContext, storeId: string, input: JsonObject) {
    const rawLines = Array.isArray(input.lines) ? input.lines as LineInput[] : [];
    const customerId = typeof input.customerId === 'string' && input.customerId ? uuid(input.customerId, 'customerId') : null;
    const customer: CustomerForPricing | null = customerId
      ? await this.prisma.customer.findFirst({ where: { id: customerId, organizationId: context.organizationId }, select: { id: true, name: true, phone: true, groupName: true, isBusiness: true, taxNumber: true, legalName: true, billingAddress: true, stateCode: true, walletBalanceCents: true, pointsBalance: true } })
      : null;
    if (customerId && !customer) throw new BadRequestException('Customer not found');

    const settings = await this.orgSettings(context.organizationId, storeId);
    const currency = currencyFromSettings(settings);
    if (settings.taxProfileStatus === 'NOT_REVIEWED' || settings.taxProfileStatus === 'UNSURE') {
      throw new BadRequestException({ code: 'TAX_PROFILE_REQUIRED', message: 'Review the organisation tax profile before creating sales. Open Organisation → Settings → General.' });
    }
    const now = new Date();
    const ruleRows = await this.prisma.priceRule.findMany({
      where: { organizationId: context.organizationId, storeId, status: 'ACTIVE' },
    });
    const rules: PriceRule[] = ruleRows.map((rule) => ({
      id: rule.id, name: rule.name, priority: rule.priority, scope: rule.scope, scopeId: rule.scopeId, storeId: rule.storeId,
      customerGroup: rule.customerGroup, minQuantity: num(rule.minQuantity), startsAt: rule.startsAt, endsAt: rule.endsAt, mode: rule.mode, value: rule.value,
    }));
    const lines = await Promise.all(rawLines.map((line) => this.priceLine(context, line, storeId, { rules, customerGroup: customer?.groupName ?? null, now, currency, taxProfileStatus: String(settings.taxProfileStatus ?? 'LEGACY'), settings })));

    const subtotal = lines.reduce((sum, line) => sum + line.netCents, 0);
    const lineDiscount = lines.reduce((sum, line) => sum + line.discountCents, 0);
    if (input.discountCents !== undefined && input.discountPercent !== undefined) throw new BadRequestException('Use either discountCents or discountPercent, not both');
    let manualOrderDiscount = 0;
    if (input.discountPercent !== undefined) {
      const percent = finiteNumber(input.discountPercent, 'discountPercent');
      if (percent < 0 || percent > Number(settings.billDiscountMaxPercent ?? 100)) throw new BadRequestException(`Bill discount cannot exceed ${settings.billDiscountMaxPercent ?? 100}%`);
      manualOrderDiscount = Math.round((subtotal * percent) / 100);
    } else manualOrderDiscount = money(input.discountCents ?? 0, 'discountCents');
    if (manualOrderDiscount > 0 && settings.billDiscountEnabled !== true) throw new BadRequestException('Whole-bill discounts are turned off for this store');
    if (manualOrderDiscount > subtotal * Number(settings.billDiscountMaxPercent ?? 100) / 100) throw new BadRequestException(`Bill discount cannot exceed ${settings.billDiscountMaxPercent ?? 100}%`);

    // Promotions: automatic ones plus at most one coupon, with stacking limits.
    const promotionRows = await this.prisma.promotion.findMany({ where: { organizationId: context.organizationId, storeId, status: 'ACTIVE' } });
    const redemptions = customer
      ? await this.prisma.promotionRedemption.groupBy({ by: ['promotionId'], where: { customerId: customer.id }, _count: { _all: true } })
      : [];
    const promotionDefs: PromotionDef[] = promotionRows.map((promotion) => ({
      id: promotion.id, code: promotion.code, type: promotion.type, value: promotion.type === 'AMOUNT' ? Math.round(num(promotion.value) * minorFactor(currency)) : num(promotion.value),
      minSubtotalCents: promotion.minSubtotalCents, usageLimit: promotion.usageLimit, usageCount: promotion.usageCount, perCustomerLimit: promotion.perCustomerLimit,
      startsAt: promotion.startsAt, endsAt: promotion.endsAt, active: promotion.status === 'ACTIVE', scope: promotion.scope, scopeId: promotion.scopeId,
      autoApply: promotion.autoApply, priority: promotion.priority, stackable: promotion.stackable,
    }));
    const promotions = evaluatePromotions({
      promotions: settings.billDiscountEnabled === true ? promotionDefs : [],
      couponCode: optionalString(input.couponCode) ?? null,
      lines: lines.map((line) => ({ variantId: line.variantId, categoryId: line.categoryId, brandId: line.brandId, netCents: line.netCents })),
      customerRedemptions: new Map(redemptions.map((row) => [row.promotionId, row._count._all])),
      hasCustomer: Boolean(customer),
      now,
    });

    if (optionalString(input.couponCode) && settings.billDiscountEnabled !== true) throw new BadRequestException('Whole-bill discounts are turned off for this store');
    if (manualOrderDiscount > 0 && promotions.totalDiscountCents > 0 && settings.allowDiscountStacking !== true) throw new BadRequestException('This store does not allow stacking a manual discount with an offer');
    const billDiscount = manualOrderDiscount + promotions.totalDiscountCents;
    if (billDiscount > Math.floor(subtotal * Number(settings.billDiscountMaxPercent ?? 100) / 100)) throw new BadRequestException(`Combined bill discounts cannot exceed ${settings.billDiscountMaxPercent ?? 100}%`);

    const discount = Math.min(billDiscount, subtotal);
    const lineTax = lines.reduce((sum, line) => sum + line.taxCents, 0);
    const itemTax = Math.max(0, lineTax - Math.round((discount * lineTax) / Math.max(1, subtotal)));
    const chargePlan = await this.computeCharges(context.organizationId, storeId, lines, subtotal - discount);
    const tax = itemTax + chargePlan.taxCents;
    const total = subtotal - discount + tax + chargePlan.netCents;
    const quoteHash = createHash('sha256').update(JSON.stringify({
      lines: lines.map((line) => [line.variantId, line.quantity, line.unitPriceCents, line.discountCents, line.taxCents, line.lineTotalCents]),
      discount, tax, charges: chargePlan.netCents, total, promotions: promotions.applied.map((entry) => [entry.promotionId, entry.discountCents]),
    })).digest('hex').slice(0, 16);
    const quote = {
      lines: lines.map((line) => ({
        variantId: line.variantId, sku: line.sku, name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents, taxRateBps: line.taxRateBps,
        taxCents: line.taxCents, netCents: line.netCents, lineTotalCents: line.lineTotalCents, discountCents: line.discountCents,
        listPriceCents: line.listPriceCents, priceSource: line.priceSource, priceRuleName: line.priceRuleName, openPrice: line.openPrice,
      })),
      subtotalCents: subtotal,
      discountCents: lineDiscount + discount,
      promotionDiscountCents: promotions.totalDiscountCents,
      promotions: promotions.applied,
      rejectedPromotions: promotions.rejected,
      chargeCents: chargePlan.netCents,
      charges: chargePlan.items,
      taxCents: tax,
      totalCents: total,
      requiresManagerApproval: lines.some((line) => line.openPrice),
      quoteHash,
    };
    return { lines, subtotal, lineDiscount, manualOrderDiscount, discount, tax, chargePlan, total, customer, promotions, quote, quoteHash, settings, currency };
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

  private async priceLine(context: UserContext, input: LineInput, storeId: string, env: { rules: PriceRule[]; customerGroup: string | null; now: Date; currency: string; taxProfileStatus: string; settings: JsonObject }): Promise<PricedLine> {
    const variantId = uuid(input.variantId, 'variantId');
    const quantity = finiteNumber(input.quantity ?? 1, 'quantity');
    if (quantity <= 0) throw new BadRequestException('quantity must be positive');
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, organizationId: context.organizationId, status: { in: [...SELLABLE_STATUSES] }, storeVariants: { some: { storeId, status: 'ACTIVE' } } },
      include: { product: { select: { name: true, categoryId: true, brandId: true } }, storeVariants: { where: { storeId }, select: { taxGroup: { select: { rateBps: true, hsnCode: true, status: true } } } }, prices: this.currentPriceFilter(storeId) },
    });
    if (!variant) throw new NotFoundException(`Sellable variant not found: ${variantId}`);
    // Tax comes only from this store's assignment; organization product data has no tax group.
    const assignedTaxGroup = variant.storeVariants[0]?.taxGroup ?? null;
    const taxGroup = assignedTaxGroup?.status === 'ACTIVE' ? assignedTaxGroup : null;
    if (env.taxProfileStatus === 'REGISTERED' && !taxGroup) {
      throw new BadRequestException({ code: 'TAX_CONFIGURATION_REQUIRED', message: `Assign an active tax group to ${variant.sku || variant.product.name} before selling it. Configure this store at /s/${storeId}/settings/tax.` });
    }

    // Price: the first matching price rule wins, the base price is the last fallback, and no price at all is an error
    // unless this is an open-price item whose price the cashier enters (a manager approves it when the sale is saved).
    const base = this.pickPrice(variant.prices, storeId);
    const resolved = resolveUnitPrice(base?.amountCents ?? null, env.rules, {
      storeId, variantId, categoryId: variant.product.categoryId, brandId: variant.product.brandId, customerGroup: env.customerGroup, quantity, now: env.now,
    });
    let unitPriceCents: number;
    let includesTax = base?.includesTax ?? false;
    let openPrice = false;
    let priceSource: PricedLine['priceSource'] = resolved.source === 'RULE' ? 'RULE' : 'BASE';
    const entered = input.unitPriceCents === undefined || input.unitPriceCents === null || input.unitPriceCents === '' ? null : money(input.unitPriceCents, 'unitPriceCents');
    if (variant.openPrice && entered !== null) {
      if (entered <= 0) throw new BadRequestException(`Enter a price above zero for ${variant.sku}`);
      if (entered < variant.floorPriceCents) throw new BadRequestException(`The price for ${variant.sku} cannot be below its floor price of ${formatMinor(variant.floorPriceCents, env.currency)}`);
      unitPriceCents = entered;
      openPrice = true;
      priceSource = 'OPEN_PRICE';
      includesTax = input.priceIncludesTax !== false;
    } else if (resolved.unitPriceCents === null) {
      if (variant.openPrice) throw new BadRequestException({ code: 'OPEN_PRICE_REQUIRED', message: `Enter a price for ${variant.sku}`, variantId });
      throw new BadRequestException({ code: 'NO_PRICE', message: `No price is set for ${variant.sku}. Ask a manager to set a price before selling it.`, variantId });
    } else unitPriceCents = resolved.unitPriceCents;

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
    if (discountCents > 0 && env.settings.lineDiscountEnabled !== true) throw new BadRequestException('Line-item discounts are turned off for this store');
    if (discountCents > Math.floor(gross * Number(env.settings.lineDiscountMaxPercent ?? 100) / 100)) throw new BadRequestException(`Line-item discount cannot exceed ${env.settings.lineDiscountMaxPercent ?? 100}%`);
    if (discountCents < 0) throw new BadRequestException('Line discount cannot be negative');
    if (discountCents > gross) throw new BadRequestException('Line discount cannot exceed the line value');
    const discountedGross = gross - discountCents;
    const tax = includesTax ? splitInclusive(discountedGross, taxBps).tax : taxOnExclusive(discountedGross, taxBps);
    const netCents = includesTax ? splitInclusive(discountedGross, taxBps).net : discountedGross;
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
      listPriceCents: base?.amountCents ?? null,
      priceSource,
      priceRuleName: resolved.source === 'RULE' && !openPrice ? resolved.ruleName : null,
      openPrice,
      categoryId: variant.product.categoryId,
      brandId: variant.product.brandId,
    };
  }

  /**
   * Organization product schema and financial identity, plus the selected store's independent billing configuration.
   */
  private async orgSettings(organizationId: string, storeId?: string): Promise<JsonObject> {
    const [row, organization] = await Promise.all([
      this.prisma.organizationSettings.findUnique({ where: { organizationId }, select: { settings: true } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { currency: true, countryCode: true, taxProfileStatus: true } }),
    ]);
    const organizationSettings = (row?.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? row.settings : {}) as JsonObject;
    const base: JsonObject = { productFields: cleanFieldSet(organizationSettings.productFields) as unknown as JsonObject };
    base.currency = organization.currency;
    base.countryCode = organization.countryCode;
    base.taxProfileStatus = organization.taxProfileStatus;
    if (!storeId) return base;
    const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId }, select: { billingSettings: true, fieldSettings: true } });
    const own = objectField(store?.billingSettings);
    Object.assign(base, DEFAULT_BILLING_SETTINGS, own);
    const fieldSettings = objectField(store?.fieldSettings);
    base.checkoutFields = cleanFieldSet(fieldSettings.checkoutFields, 'CHECKOUT') as unknown as JsonObject;
    return base;
  }

  private enabledTenders(settings: JsonObject): TenderType[] {
    const configured = Array.isArray(settings.enabledTenders) ? settings.enabledTenders.filter((value): value is TenderType => typeof value === 'string' && (TENDERS as string[]).includes(value)) : [];
    return configured.length ? configured : TENDERS;
  }

  private async discountReasonText(context: UserContext, storeId: string, input: JsonObject, lines: PricedLine[], settings: JsonObject, requestedDiscount: number): Promise<string> {
    const code = optionalString(input.discountReasonCode);
    if (code) {
      const reason = await this.prisma.discountReason.findFirst({ where: { organizationId: context.organizationId, storeId, code: code.toUpperCase(), status: 'ACTIVE' } });
      if (!reason) throw new BadRequestException('Unknown discount reason');
      return reason.name;
    }
    if (requestedDiscount > 0 && settings.requireDiscountReasonCode === true) throw new BadRequestException('Choose a discount reason from the list');
    return optionalString(input.discountReason) ?? lines.find((line) => line.discountReason)?.discountReason ?? '';
  }

  private async paymentPlan(context: UserContext, storeId: string, value: unknown, expectedTotalCents: number, customer: CustomerForPricing | null, settings: JsonObject) {
    const values = Array.isArray(value) ? value as JsonObject[] : [];
    if (!values.length) throw new BadRequestException('At least one payment is required');
    const attemptIds = values.flatMap((payment) => (isUuid(payment.attemptId) ? [payment.attemptId] : []));
    if (new Set(attemptIds).size !== attemptIds.length) throw new BadRequestException('The same payment cannot be used twice');
    const attempts = await this.payments.usableAttempts(context, storeId, attemptIds);
    const tenderTypes = values.map((payment) => (isUuid(payment.attemptId) ? attempts.get(payment.attemptId)!.tenderType : oneOf(payment.tenderType, TENDERS, 'tenderType')));
    const enabled = this.enabledTenders(settings);
    for (const tender of tenderTypes) if (!enabled.includes(tender)) throw new BadRequestException(`${tender} payments are switched off for this store`);
    const onlyCash = tenderTypes.every((tender) => tender === 'CASH');
    const cashRoundingCents = onlyCash ? this.cashRoundingFrom(settings) : 0;
    const roundedTotalCents = cashRoundingCents > 0 ? Math.round(expectedTotalCents / cashRoundingCents) * cashRoundingCents : expectedTotalCents;
    const pointValueCents = Number.isInteger(settings.pointValueCents) && (settings.pointValueCents as number) > 0 ? settings.pointValueCents as number : 10;
    let walletCents = 0;
    let pointsUsed = 0;
    const payments = values.map((payment, index) => {
      const tenderType = tenderTypes[index]!;
      const attempt = isUuid(payment.attemptId) ? attempts.get(payment.attemptId) : undefined;
      const tenderedCents = payment.tenderedCents === undefined ? null : money(payment.tenderedCents, 'tenderedCents');
      const requestedAmount = attempt ? attempt.amountCents : payment.amountCents === undefined ? tenderedCents : money(payment.amountCents);
      if (requestedAmount === null || requestedAmount === undefined) throw new BadRequestException('amountCents is required for every payment');
      if (attempt && payment.amountCents !== undefined && money(payment.amountCents) !== attempt.amountCents) throw new BadRequestException('The amount does not match the confirmed payment');
      const amountCents = onlyCash && values.length === 1 && tenderType === 'CASH' && tenderedCents !== null ? roundedTotalCents : requestedAmount;
      if (amountCents <= 0) throw new BadRequestException('Every payment must be greater than zero');
      if (tenderedCents !== null && tenderType !== 'CASH') throw new BadRequestException('tenderedCents is only valid for cash');
      if (tenderedCents !== null && tenderedCents < amountCents) throw new BadRequestException('Cash tendered cannot be less than the applied amount');
      if (tenderType === 'WALLET' || tenderType === 'POINTS') {
        if (!customer) throw new BadRequestException('Attach a customer to pay with wallet or points');
        if (tenderType === 'WALLET') walletCents += amountCents;
        else {
          if (amountCents % pointValueCents !== 0) throw new BadRequestException(`Points are worth ${formatMinor(pointValueCents, currencyFromSettings(settings))} each; the amount must be a whole number of points`);
          pointsUsed += amountCents / pointValueCents;
        }
      }
      return {
        tenderType,
        amountCents,
        tenderedCents,
        changeCents: tenderedCents === null ? 0 : tenderedCents - amountCents,
        reference: attempt ? attempt.providerRef : optionalString(payment.reference) ?? '',
        ...(attempt ? { attemptId: attempt.id } : {}),
      } as { tenderType: TenderType; amountCents: number; tenderedCents: number | null; changeCents: number; reference: string; attemptId?: string };
    });
    if (customer && walletCents > customer.walletBalanceCents) throw new BadRequestException(`Wallet balance is only ${formatMinor(customer.walletBalanceCents, currencyFromSettings(settings))}. Pay the rest another way.`);
    if (customer && pointsUsed > customer.pointsBalance) throw new BadRequestException(`The customer only has ${customer.pointsBalance} points. Pay the rest another way.`);
    return {
      payments,
      appliedTotalCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0),
      roundedTotalCents,
      roundingCents: roundedTotalCents - expectedTotalCents,
      walletCents,
      pointsUsed,
    };
  }

  /** Seller, buyer and place of supply as they are now, saved on the sale so a reprint never changes. */
  private async documentSnapshot(context: UserContext, storeId: string, customer: CustomerForPricing | null, settings: JsonObject): Promise<JsonObject> {
    const [organization, store] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: context.organizationId }, select: { name: true, legalName: true, tradeName: true, address: true, gstin: true } }),
      this.prisma.store.findUnique({ where: { id: storeId }, select: { name: true, code: true, address: true, taxNumber: true, timezone: true } }),
    ]);
    const sellerTaxNumber = store?.taxNumber || organization?.gstin || '';
    const sellerState = gstinStateCode(sellerTaxNumber);
    const buyerState = customer ? customer.stateCode || gstinStateCode(customer.taxNumber) : '';
    const intraState = isIntraState(sellerState, buyerState);
    const supplyState = buyerState || sellerState;
    return {
      version: 1,
      currency: currencyFromSettings(settings),
      seller: {
        name: organization?.legalName || organization?.tradeName || organization?.name || 'Invoice',
        address: organization?.address ?? '',
        taxNumber: sellerTaxNumber,
        stateCode: sellerState,
        storeName: store?.name ?? '',
        storeCode: store?.code ?? '',
        storeAddress: store?.address ?? '',
        timezone: store?.timezone ?? 'Asia/Kolkata',
      },
      buyer: customer ? { name: customer.name, phone: customer.phone, isBusiness: customer.isBusiness, legalName: customer.legalName, taxNumber: customer.taxNumber, address: customer.billingAddress, stateCode: buyerState } : null,
      placeOfSupply: { stateCode: supplyState, stateName: GST_STATES[supplyState] ?? '', intraState },
      footer: typeof settings.receiptFooter === 'string' ? settings.receiptFooter : '',
    };
  }

  /** The manager whose PIN was entered. Any active manager of this store (or organisation-wide) may approve. */
  private async verifyManagerPin(context: UserContext, storeId: string, managerPin: unknown, action: string, message: string): Promise<string> {
    const refuse = (text: string) => new ForbiddenException({ code: 'REQUIRE_APPROVAL', action, message: text });
    if (typeof managerPin !== 'string' || managerPin.length === 0) throw refuse(message);
    const managers = await this.prisma.user.findMany({
      where: {
        organizationId: context.organizationId,
        id: { not: context.userId },
        status: 'ACTIVE',
        pinHash: { not: null },
        roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permissionCode: 'approval.manage', effect: { in: ['ALLOW', 'REQUIRE_APPROVAL'] } } } }, OR: [{ scopeType: 'ORGANIZATION' }, { scopeType: 'STORE', storeId }] } },
      },
      select: { id: true, pinHash: true },
    });
    const manager = managers.find((candidate) => candidate.pinHash && verifyPassword(managerPin, candidate.pinHash));
    if (!manager) throw refuse('Manager PIN is invalid');
    return manager.id;
  }

  private approvalPayloadHash(action: string, storeId: string, referenceId: string, payload: JsonObject): string {
    const stable = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stable);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
      return value;
    };
    return createHash('sha256').update(JSON.stringify([action, storeId, referenceId, stable(payload)])).digest('hex');
  }

  private async findApprovalToken(context: UserContext, approvalId: unknown, action: string, storeId: string, referenceId: string, payload: JsonObject) {
    const id = isUuid(approvalId) ? approvalId : null;
    const approval = id ? await this.prisma.approval.findFirst({
      where: {
        id, organizationId: context.organizationId, storeId, action, referenceId,
        requestedById: context.userId, status: 'APPROVED', consumedAt: null,
        expiresAt: { gt: new Date() }, payloadHash: this.approvalPayloadHash(action, storeId, referenceId, payload),
      },
      select: { id: true, approvedById: true },
    }) : null;
    if (!approval?.approvedById || approval.approvedById === context.userId) {
      throw new ForbiddenException({ code: 'REQUIRE_APPROVAL', action, message: 'A valid, approved authorization for these exact details is required' });
    }
    return { tokenId: approval.id, approvedById: approval.approvedById };
  }

  private async consumeApprovalToken(tx: Tx, context: UserContext, tokenId: string, action: string, storeId: string, referenceId: string, payload: JsonObject) {
    const now = new Date();
    const result = await tx.approval.updateMany({
      where: {
        id: tokenId, organizationId: context.organizationId, storeId, action, referenceId,
        requestedById: context.userId, status: 'APPROVED', approvedById: { not: context.userId }, consumedAt: null,
        expiresAt: { gt: now }, payloadHash: this.approvalPayloadHash(action, storeId, referenceId, payload),
      },
      data: { consumedAt: now },
    });
    if (!result.count) throw new ConflictException('The authorization has expired, changed or was already used');
    await this.audit.record(context, 'approval.consumed', 'Approval', tokenId, { action, referenceId, storeId }, tx);
  }

  /** Discounts above the configured threshold need an approved manager authorisation for SALE_DISCOUNT. */
  private async assertDiscountAllowed(context: UserContext, storeId: string, discountCents: number, subtotalCents: number, referenceId: string, approvalId: unknown, managerPin: unknown): Promise<{ approvedById: string; tokenId?: string } | null> {
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
    if (typeof managerPin === 'string' && managerPin.length > 0) return { approvedById: await this.verifyManagerPin(context, storeId, managerPin, 'SALE_DISCOUNT', 'This discount needs manager approval') };
    if (approvalId === undefined) throw requireApproval();
    return this.findApprovalToken(context, approvalId, 'SALE_DISCOUNT', storeId, referenceId, { discountCents, subtotalCents });
  }

  /** Refunds above the organisation's configured amount, or with a REQUIRE_APPROVAL role effect, need a manager. */
  private async assertRefundAllowed(context: UserContext, storeId: string, totalCents: number, referenceId: string, approvalId: unknown, managerPin: unknown): Promise<{ approvedById: string; tokenId?: string } | null> {
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
    if (typeof managerPin === 'string' && managerPin.length > 0) return { approvedById: await this.verifyManagerPin(context, storeId, managerPin, 'RETURN_REFUND', 'This refund needs manager approval') };
    if (approvalId === undefined) throw requireApproval();
    return this.findApprovalToken(context, approvalId, 'RETURN_REFUND', storeId, referenceId, { totalCents });
  }

  private cashRoundingFrom(settings: JsonObject): number {
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
  /** Gap-free numbers per store, kind and financial year (April-March): TAX-2627-000001. Rolls back with the sale. */
  private async nextDocumentNumber(tx: Tx, organizationId: string, storeId: string, kind: 'TAX' | 'CN') {
    const store = await tx.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
    const year = financialYearLabel(new Date(), store?.timezone ?? 'Asia/Kolkata');
    const sequence = await tx.documentSequence.upsert({
      where: { storeId_kind: { storeId, kind: `${kind}-${year}` } },
      create: { organizationId, storeId, kind: `${kind}-${year}`, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `${kind}-${year}-${String(sequence.lastValue).padStart(6, '0')}`;
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

  /** What happens when a sale would take stock below zero in this store: BLOCK, WARN or ALLOW. The till uses it to decide whether an out-of-stock item can be added. */
  async inventoryPolicyFor(organizationId: string, storeId: string) {
    return this.negativeStockPolicy(this.prisma as unknown as Tx, organizationId, storeId);
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
    const key = createHash('sha256').update(`${context.organizationId}|${storeId ?? ''}|${type}|${referenceId ?? message}`).digest('hex');
    await tx.alert.upsert({
      where: { activeDedupeKey: key },
      create: { organizationId: context.organizationId, type, severity, message, referenceId, storeId, activeDedupeKey: key },
      update: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), severity, message },
    });
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
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field} must be a valid date`);
    return date;
  }

  private localDate(value: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private localDayBounds(dateText: string, timeZone: string): { from: Date; to: Date } {
    const start = this.dayBoundary(dateText, 'businessDate', false);
    const next = new Date(start.getTime() + 86_400_000);
    const toDateText = next.toISOString().slice(0, 10);
    const midnight = (date: string) => {
      const [year, month, day] = date.split('-').map(Number);
      const desired = Date.UTC(year!, month! - 1, day!);
      let instant = desired;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
        const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
        const representedAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
        instant = desired - (representedAsUtc - instant);
      }
      return new Date(instant);
    };
    return { from: midnight(dateText), to: midnight(toDateText) };
  }

  private async ensureStore(organizationId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId }, select: { id: true } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
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
        promotions: Array.isArray(sale.promotions) ? sale.promotions : [],
        roundingCents: sale.roundingCents,
        totalCents: sale.totalCents,
        notes: sale.notes,
        customerId: sale.customerId,
        handledById: sale.handledById,
        customFields: objectField(sale.customFields),
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
      perCustomerLimit: promotion.perCustomerLimit,
      scope: promotion.scope,
      scopeId: promotion.scopeId,
      autoApply: promotion.autoApply,
      priority: promotion.priority,
      stackable: promotion.stackable,
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

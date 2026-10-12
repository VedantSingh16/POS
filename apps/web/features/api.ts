import "server-only";
/* API payloads are validated and mapped at this server-only boundary; the upstream contract is JSON. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as m from "@/features/types";
import { apiFetch, sessionToken } from "@/lib/server/session";

export type Result<T> = { data: T };

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly path: string) { super(message); }
}

/** Run a secondary request without letting its failure take the whole page down. */
export async function soft<T>(task: Promise<Result<T>>, fallback: T, onError?: (message: string) => void): Promise<Result<T>> {
  try { return await task; }
  catch (error) { onError?.(error instanceof Error ? error.message : "Request failed"); return { data: fallback }; }
}

async function read<T>(path: string, init: RequestInit & { storeId?: string } = {}): Promise<T> {
  const token = await sessionToken();
  const response = await apiFetch(path, { ...init, token });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string | string[] };
    const detail = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    // Logged on the web server so a failing page can be traced to the exact API call.
    console.error(`[api] ${init.method ?? "GET"} ${path} -> ${response.status} ${detail ?? ""}`);
    throw new ApiError(detail ?? `API request failed (${response.status})`, response.status, path);
  }
  return response.status === 204 ? (undefined as T) : await response.json() as T;
}

const real = <T,>(data: T): Result<T> => ({ data });

export type ProductRow = Omit<m.Product, "status"> & { status: string; productId?: string; variantId?: string; variants?: unknown[]; barcodes?: string[]; brand?: string; taxGroupId?: string | null };
type ChargeRow = m.ChargeRow;
export type CatalogProductDetail = {
  id: string; name: string; description: string; brand: string; categoryId: string | null;
  category: { id: string; name: string } | null; status: string;
  variants: { id: string; productId: string; sku: string; name: string; costCents: number; status: string; uomId: string | null; taxGroupId: string | null; barcodes: string[]; prices: { id: string; amountCents: number; currency: string; includesTax: boolean; effectiveFrom: string }[] }[];
};
type UserRow = m.UserRow;
type RoleRow = m.RoleRow;
type StoreRow = m.StoreBase & { managers?: { id: string; name: string; email: string }[] };
type CustomerRow = m.CustomerRow;
type SaleRow = m.SaleRow;
type ReturnRow = m.ReturnRow;
type InventoryRow = m.InventoryRow;
type LedgerRow = m.LedgerRow;
type RegisterRow = m.RegisterRow;
type ApprovalRow = m.ApprovalRow;
type AlertRow = m.AlertRow;
type AuditRow = m.AuditRow;

function productRows(products: any[]): ProductRow[] {
  return products.flatMap((product) => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    return (variants.length ? variants : [{ id: product.id, sku: "", name: product.name, prices: [], barcodes: [], status: product.status }]).map((variant: any) => {
      const price = variant.prices?.[0];
      return {
        id: variant.id,
        productId: product.id,
        variantId: variant.id,
        sku: variant.sku ?? "",
        barcode: variant.barcodes?.[0] ?? "",
        name: `${product.name}${variant.name ? ` · ${variant.name}` : ""}`,
        category: product.category?.name ?? product.categoryName ?? "Uncategorised",
        categoryId: product.categoryId ?? null,
        brand: product.brand ?? "",
        priceMinor: price?.amountCents ?? 0,
        taxRate: Number(variant.taxRate ?? variant.taxGroup?.ratePercent ?? 0),
        taxGroupId: variant.taxGroupId ?? null,
        stock: 0,
        status: variant.status ?? product.status ?? "ACTIVE",
        hot: false,
      };
    });
  });
}

/** Role names and where each applies, with store names instead of ids. */
function userRow(user: any, storeNames: Map<string, string>) {
  const assignments: { name: string; scopeType: string; scopeId: string | null }[] = user.roles ?? [];
  const role = assignments.length ? [...new Set(assignments.map((a) => a.name))].join(", ") : "No role";
  const scope = assignments.length
    ? [...new Set(assignments.map((a) => (a.scopeType === "STORE" ? storeNames.get(a.scopeId ?? "") ?? "A store" : "Organisation-wide")))].join(", ")
    : "No access";
  return { id: user.id, name: `${user.firstName} ${user.lastName}`.trim(), email: user.email, role, scope, status: user.status, lastLogin: user.lastLoginAt ?? "" };
}

/** Counts from the API can be missing on older servers; never let that surface as NaN in the UI. */
const count = (...values: unknown[]): number => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.length;
  }
  return 0;
};

export const api = {
  async onboarding() {
    return real(await read<any>("/admin/onboarding"));
  },
  async org() {
    const value = await read<any>("/admin/overview");
    return real({ id: value.organization.id, name: value.organization.name, maxStores: value.entitlement.maxStores });
  },
  async orgProfile() {
    const { organization: o } = await read<any>("/admin/overview");
    return real({ name: o.name ?? "", legalName: o.legalName ?? "", tradeName: o.tradeName ?? "", gstin: o.gstin ?? "", address: o.address ?? "", timezone: o.timezone ?? "Asia/Kolkata", businessType: o.businessType ?? "RETAIL" });
  },
  async transfers() {
    const value = await read<any>("/pos/v1/transfers");
    return real((Array.isArray(value) ? value : value.transfers ?? []) as { id: string; fromLocationName: string; toLocationName: string; status: string; notes: string | null; createdAt: string; lines: { variantId: string; sku: string; name: string; requestedQuantity: number; dispatchedQuantity: number; receivedQuantity: number }[] }[]);
  },
  async uoms() {
    const value = await read<any>("/admin/catalog/uoms");
    return real((Array.isArray(value) ? value : value.uoms ?? []) as { id: string; code: string; name: string; allowsDecimal: boolean }[]);
  },
  async settings() {
    const value = await read<any>("/admin/settings");
    return real((value.settings ?? {}) as Record<string, unknown>);
  },
  async approvalPolicy() {
    const value = await read<any>("/admin/approval-policy");
    return real({ enabled: value.enabled !== false, thresholdPercent: Number(value.thresholdPercent ?? 10) });
  },
  async stores() {
    const value = await read<any>("/admin/stores");
    return real((value.stores ?? []).map((store: any) => ({
      id: store.id, code: store.code, name: store.name, city: store.address ?? "", status: store.status,
      registers: Number(store.registerCount ?? 0), staff: Number(store.staffCount ?? 0),
      managers: (store.managers ?? []) as { id: string; name: string; email: string }[],
    })) as StoreRow[]);
  },
  async store(id: string) {
    const store = await read<any>(`/admin/stores/${id}`);
    // `registers` stays the list returned by the API; `registerCount` is the number to display.
    return real({ ...store, city: store.address ?? "", registerCount: (store.registers ?? []).length } as typeof store & { city: string; registerCount: number });
  },
  async storeSettings(id: string) {
    return real(await read<any>(`/admin/stores/${id}/settings`, { storeId: id }));
  },
  async storeStaff(id: string) {
    const value = await read<any>(`/admin/stores/${id}/users`, { storeId: id });
    return real((value.users ?? []).map((user: any) => ({ id: user.id, name: `${user.firstName} ${user.lastName}`.trim(), email: user.email, role: (user.roles ?? []).map((role: any) => role.name).join(", ") || "Store staff", scope: "This store", status: user.status, lastLogin: user.lastLoginAt ?? "" })) as UserRow[]);
  },
  async users() {
    const [value, storeValue] = await Promise.all([read<any>("/admin/users"), read<any>("/admin/stores").catch(() => ({ stores: [] }))]);
    const names = new Map<string, string>((storeValue.stores ?? []).map((store: any) => [store.id, store.name]));
    return real((value.users ?? []).map((user: any) => userRow(user, names)) as UserRow[]);
  },
  async user(id: string) {
    const [user, storeValue] = await Promise.all([read<any>(`/admin/users/${id}`), read<any>("/admin/stores").catch(() => ({ stores: [] }))]);
    const names = new Map<string, string>((storeValue.stores ?? []).map((store: any) => [store.id, store.name]));
    return real({ ...user, ...userRow(user, names) });
  },
  async effectiveAccess(id: string) {
    return real(await read<any>(`/admin/users/${id}/effective-access`));
  },
  async roles() {
    const value = await read<any>("/admin/roles");
    return real((value.roles ?? []).map((role: any) => ({
      ...role,
      users: count(role.userCount),
      permissions: count(role.permissionCount, role.permissions),
      system: Boolean(role.isSystem),
    })) as RoleRow[]);
  },
  async role(id: string) {
    const role = await read<any>(`/admin/roles/${id}`);
    return real({
      ...role,
      users: count(role.userCount),
      permissions: count(role.permissionCount, role.permissions),
      system: Boolean(role.isSystem),
    });
  },
  async permissionGroups() {
    const value = await read<any>("/admin/permission-groups");
    return real(value.groups ?? []);
  },
  async products(storeId?: string) {
    if (storeId) {
      const value = await read<any>(`/pos/v1/catalog/search?storeId=${encodeURIComponent(storeId)}`, { storeId });
      return real((value.products ?? []).map((variant: any) => ({
        id: variant.variantId,
        variantId: variant.variantId,
        sku: variant.sku ?? "",
        barcode: variant.barcode ?? "",
        barcodes: Array.isArray(variant.barcodes) ? variant.barcodes : variant.barcode ? [variant.barcode] : [],
        name: variant.variantName && variant.variantName !== variant.productName ? `${variant.productName} · ${variant.variantName}` : variant.productName,
        category: variant.categoryName || "Uncategorised",
        brand: variant.brand ?? "",
        priceMinor: variant.priceCents ?? 0,
        includesTax: variant.includesTax === true,
        taxRate: (variant.taxBps ?? 0) / 100,
        stock: variant.stock ?? 0,
        status: "ACTIVE" as const,
        hot: true,
      })) as ProductRow[]);
    }
    const value = await read<any>("/admin/catalog/products");
    const rows = productRows(value.products ?? []);
    if (storeId) {
      const stock = await read<any>(`/pos/v1/inventory?storeId=${encodeURIComponent(storeId)}`);
      const byVariant = new Map((stock.balances ?? []).filter((balance: any) => balance.status === "SELLABLE").map((balance: any) => [balance.variantId, balance.quantity]));
      for (const row of rows) row.stock = Number(byVariant.get(row.variantId) ?? 0);
    }
    return real(rows);
  },
  async storePending(storeId: string) {
    const value = await read<any>(`/pos/v1/stores/${storeId}/pending-verification`, { storeId });
    return real((value.items ?? []) as { variantId: string; sku: string; name: string; brand: string; category: string; suggestedPriceCents: number; taxGroup: { id: string; name: string; rateBps: number } | null; pendingQuantity: number }[]);
  },
  /** Organisation-wide tax groups plus the store's own. */
  async storeTaxGroups(storeId: string) {
    const value = await read<any>(`/pos/v1/tax-groups?storeId=${encodeURIComponent(storeId)}`, { storeId });
    return real((value.taxGroups ?? []) as { id: string; code: string; name: string; hsnCode: string; ratePercent: number; includesTax: boolean; storeId: string | null; scope: "ORGANISATION" | "STORE" }[]);
  },
  /** storeId omitted = organisation-wide charges only; given = organisation + that store. */
  async charges(storeId?: string) {
    const value = await read<any>(`/pos/v1/charges${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`, storeId ? { storeId } : {});
    return real((value.charges ?? []) as ChargeRow[]);
  },
  async storeLookups(storeId: string) {
    const value = await read<any>(`/pos/v1/stores/${storeId}/lookups`, { storeId });
    return real({ categories: (value.categories ?? []) as { id: string; name: string }[], brands: (value.brands ?? []) as { id: string; name: string }[] });
  },
  async storeTaxonomy(storeId: string) {
    const value = await read<any>(`/pos/v1/stores/${storeId}/taxonomy`, { storeId });
    return real({ categories: (value.categories ?? []) as { id: string; name: string; products: number }[], brands: (value.brands ?? []) as { id: string | null; name: string; products: number }[] });
  },
  async distributions() {
    const value = await read<any>(`/pos/v1/distributions`);
    return real((value.distributions ?? []) as { id: string; status: string; toStoreId: string; toStoreName: string; toStoreCode: string; notes: string; createdAt: string; lines: { variantId: string; sku: string; name: string; quantity: number; acceptedQuantity: number; rejectedQuantity: number; suggestedPriceCents: number | null; suggestedTaxGroupId: string | null }[] }[]);
  },
  async storeCatalogue(storeId: string) {
    const value = await read<any>(`/pos/v1/store-products?storeId=${encodeURIComponent(storeId)}`, { storeId });
    return real((value.items ?? []) as m.StoreCatalogueItem[]);
  },
  async product(id: string): Promise<Result<CatalogProductDetail>> {
    return real(await read<CatalogProductDetail>(`/admin/catalog/products/${id}`));
  },
  async categories(storeId?: string) {
    const value = await read<any>(storeId ? `/pos/v1/catalog/categories?storeId=${encodeURIComponent(storeId)}` : "/admin/catalog/categories", storeId ? { storeId } : {});
    const counts = new Map<string, number>();
    if (!storeId) {
      const catalogue = await read<any>("/admin/catalog/products").catch(() => ({ products: [] }));
      for (const product of catalogue.products ?? []) if (product.categoryId) counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
    }
    return real((value.categories ?? []).map((category: any) => ({ id: category.id, name: category.name, products: counts.get(category.id) ?? 0 })) as m.CategoryRow[]);
  },
  async brands() {
    const value = await read<any>("/admin/catalog/brands");
    return real((value.brands ?? []) as m.BrandRow[]);
  },
  async taxGroups() {
    const value = await read<any>("/admin/catalog/tax-groups");
    const catalogue = await read<any>("/admin/catalog/products").catch(() => ({ products: [] }));
    const counts = new Map<string, number>();
    for (const product of catalogue.products ?? []) for (const variant of product.variants ?? []) if (variant.taxGroupId) counts.set(variant.taxGroupId, (counts.get(variant.taxGroupId) ?? 0) + 1);
    return real((value.taxGroups ?? []).map((tax: any) => ({ ...tax, id: tax.id, name: tax.name, rate: tax.ratePercent, products: counts.get(tax.id) ?? 0 })) as m.TaxGroupRow[]);
  },
  async customers(storeId?: string) {
    const value = await read<any>(storeId ? `/pos/v1/customers?storeId=${encodeURIComponent(storeId)}` : "/pos/v1/customers", storeId ? { storeId } : {});
    return real((value.customers ?? []).map((customer: any) => ({ id: customer.id, name: customer.name, phone: customer.phone, tier: customer.groupName, walletMinor: customer.walletBalanceCents, lifetimeMinor: 0, lastVisit: "", ...customer })) as CustomerRow[]);
  },
  async customer(id: string) {
    const value = await read<any>(`/pos/v1/customers/${id}`);
    return real({ id: value.id, name: value.name, phone: value.phone, tier: value.groupName, walletMinor: value.walletBalanceCents, lifetimeMinor: value.lifetimeSpendCents, lastVisit: value.sales?.[0]?.createdAt ?? "", ...value });
  },
  async sales(storeId?: string, range?: { from: string; to: string }) {
    const query = [storeId ? `storeId=${encodeURIComponent(storeId)}` : "", range ? `from=${range.from}&to=${range.to}` : ""].filter(Boolean).join("&");
    const value = await read<any>(`/pos/v1/sales${query ? `?${query}` : ""}`);
    return real((value.sales ?? []).map((sale: any) => ({ id: sale.id, receipt: sale.receiptNumber, at: sale.createdAt, cashier: sale.cashier, register: sale.register, items: sale.itemCount, totalMinor: sale.totalCents, tender: sale.tender, status: sale.status, ...sale })) as SaleRow[]);
  },
  async sale(id: string, storeId?: string) {
    const sale = await read<any>(`/pos/v1/sales/${id}`, storeId ? { storeId } : {});
    return real({ id: sale.id, receipt: sale.receiptNumber, at: sale.createdAt, cashier: sale.cashier, register: sale.register, items: sale.lines?.length ?? 0, totalMinor: sale.totalCents, tender: sale.payments?.map((p: any) => p.tenderType).join(" + ") ?? "", status: sale.status, ...sale });
  },
  async returns(storeId?: string) {
    const value = await read<any>(`/pos/v1/returns${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
    return real((value.returns ?? []).map((item: any) => ({ id: item.id, number: item.creditNoteNumber, at: item.createdAt, receipt: item.receiptNumber, reason: item.reason, refundMinor: item.totalCents, method: item.refundTender, status: item.status, ...item })) as ReturnRow[]);
  },
  async inventory(storeId?: string) {
    const value = await read<any>(`/pos/v1/inventory${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
    return real((value.balances ?? []).filter((balance: any) => balance.status === "SELLABLE").map((balance: any) => ({ id: balance.variantId, sku: balance.sku, name: balance.name, locationId: balance.locationId, variantId: balance.variantId, onHand: balance.quantity, reorderLevel: balance.reorderPoint, status: balance.quantity <= 0 ? "OUT" : balance.quantity <= balance.reorderPoint ? "LOW" : "OK" })) as InventoryRow[]);
  },
  async ledger(storeId?: string) {
    const value = await read<any>(`/pos/v1/inventory/ledger${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
    return real((value.movements ?? []).map((movement: any) => ({ id: movement.id, at: movement.createdAt, sku: movement.sku, name: movement.name, type: movement.type, qty: movement.quantity, ref: movement.referenceId ?? movement.reason, ...movement })) as LedgerRow[]);
  },
  async locations(storeId?: string) {
    const value = await read<any>(storeId ? `/pos/v1/locations?storeId=${encodeURIComponent(storeId)}` : "/pos/v1/locations", storeId ? { storeId } : {});
    return real((value.locations ?? []) as { id: string; name: string; storeId: string | null }[]);
  },
  async registers(storeId?: string) {
    const current = storeId ?? (await this.stores()).data[0]?.id;
    if (!current) return real([]);
    const value = await read<any>(`/admin/stores/${current}/registers`);
    const sessions = await read<any>(`/pos/v1/sessions?storeId=${encodeURIComponent(current)}`);
    const openByRegister = new Map((sessions.sessions ?? []).filter((session: any) => session.status === "OPEN").map((session: any) => [session.registerId, session]));
    return real((value.registers ?? []).map((register: any) => { const session = openByRegister.get(register.id) as any; return { id: register.id, name: register.name, status: session ? "OPEN" : "CLOSED", cashier: session?.openedByName || "—", openedAt: session?.openedAt ?? "", expectedMinor: session?.expectedCashCents ?? 0, sessionId: session?.id ?? "", code: register.code, registerStatus: register.status }; }) as RegisterRow[]);
  },
  async registerSession(id: string, storeId?: string) {
    const value = await read<any>(`/pos/v1/sessions/${id}/summary`, storeId ? { storeId } : {});
    return real({ id: value.session.id, name: value.session.registerName, status: value.session.status, cashier: value.session.openedByName || "—", expectedMinor: value.session.expectedCashCents, ...value.session, summary: value });
  },
  async approvals(storeId?: string) {
    const value = await read<any>(`/pos/v1/approvals${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
    return real((value.approvals ?? []).map((approval: any) => ({ id: approval.id, at: approval.createdAt, type: approval.action, requestedBy: approval.requestedBy, detail: approval.reason, status: approval.status, ...approval })) as ApprovalRow[]);
  },
  async alerts(storeId?: string) {
    const value = await read<any>(`/pos/v1/alerts${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
    return real((value.alerts ?? []).map((alert: any) => ({ id: alert.id, at: alert.createdAt, severity: String(alert.severity).toLowerCase(), title: alert.type, detail: alert.message, ...alert })) as AlertRow[]);
  },
  async reports(storeId?: string) {
    const value = await read<any>(`/pos/v1/reports${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
    return real(value);
  },
  async audit() {
    const value = await read<any>("/admin/audit");
    // Resolve actor ids to people; if the caller cannot list users, fall back to a neutral label rather than a raw id.
    const people = new Map<string, string>();
    try {
      const users = await read<any>("/admin/users");
      for (const user of users.users ?? []) people.set(user.id, `${user.firstName} ${user.lastName}`.trim() || user.email);
    } catch { /* actor names are optional */ }
    const label = (entry: any) => {
      const meta = (entry.metadata ?? {}) as Record<string, unknown>;
      const named = meta.name ?? meta.email ?? meta.sku ?? meta.code;
      return `${entry.entityType}${named ? ` · ${String(named)}` : entry.entityId ? ` · ${String(entry.entityId).slice(0, 8)}` : ""}`;
    };
    const detail = (meta: Record<string, unknown> | null | undefined) => Object.entries(meta ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
    return real((value.audit ?? []).map((entry: any) => ({ ...entry, id: entry.id, at: entry.createdAt, actor: entry.actorUserId ? people.get(entry.actorUserId) ?? "Former user" : "System", action: entry.action, entity: label(entry), detail: detail(entry.metadata) })) as AuditRow[]);
  },
  async charts(storeId?: string) {
    const value = await read<any>(`/pos/v1/reports${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`);
    const tenderTotal = Number(value.tenderTotalCents ?? 0);
    return real({
      trend: (value.trend ?? []).map((item: any) => ({ day: item.day, sales: item.sales })),
      byHour: (value.byHour ?? []).map((item: any) => ({ hour: item.hour, sales: item.sales })),
      tender: (value.tenders ?? []).map((item: any) => ({ name: item.tenderType, value: tenderTotal ? Math.round((item.amountCents / tenderTotal) * 100) : 0 })),
    });
  },
};


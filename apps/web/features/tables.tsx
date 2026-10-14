"use client";
// Column definitions for every list page. One DataTable, many column sets.
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data/data-table";
import { Money, StatusBadge } from "@/components/data/primitives";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { RelativeTime } from "@/components/data/relative-time";
import type * as M from "@/features/types";
import { ApprovalButtons, EditTaxGroupSheet, RegisterAdminActions, ThresholdSheet } from "@/features/actions";
import { useMemo, useState } from "react";
import { filterCatalogProducts } from "@/features/catalog/product-filters";
import { FilterBar } from "@/features/catalog/filter-bar";
import { ProductVersionFilter, type ProductVersionOption } from "@/features/catalog/product-version-filter";
import type { ConfiguredField } from "@/features/settings/configurable-field-values";

type Row<T> = ColumnDef<T, unknown>[];
const when = (v: string) => (v ? <span className="text-muted-foreground"><RelativeTime value={v} /></span> : <span className="text-muted-foreground">—</span>);
const mono = (v: string) => <span className="font-mono text-xs">{v}</span>;
const num = (v: number) => <span className="tabular">{formatNumber(v)}</span>;

type User = M.UserRow;
export function UsersTable({ data }: { data: User[] }) {
  const cols: Row<User> = [
    { accessorKey: "name", header: "Name", cell: (c) => <Link href={`/org/users/${c.row.original.id}`} className="font-medium hover:underline">{c.getValue() as string}</Link> },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "role", header: "Role" },
    { accessorKey: "scope", header: "Works in", cell: (c) => { const v = c.getValue() as string; return v.includes("Organisation-wide") ? <Badge tone="warning">{v}</Badge> : <span>{v}</span>; } },
    { accessorKey: "status", header: "Status", cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { accessorKey: "lastLogin", header: "Last sign-in", cell: (c) => when(c.getValue() as string) },
  ];
  return <DataTable columns={cols} data={data} rowHref={(r) => `/org/users/${r.id}`} searchPlaceholder="Search team members…" emptyTitle="No team members yet" emptyDescription="Add a store manager or other staff to get started." />;
}

type Role = M.RoleRow;
export function RolesTable({ data }: { data: Role[] }) {
  const cols: Row<Role> = [
    { accessorKey: "name", header: "Role", cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { accessorKey: "description", header: "Description" },
    { accessorKey: "users", header: "Assigned to", cell: (c) => <span className="tabular">{Number.isFinite(c.getValue() as number) ? `${c.getValue() as number} ${(c.getValue() as number) === 1 ? "person" : "people"}` : "—"}</span> },
    { accessorKey: "permissions", header: "Permissions", cell: (c) => Number.isFinite(c.getValue() as number) ? num(c.getValue() as number) : <span className="text-muted-foreground">—</span> },
    { accessorKey: "system", header: "Type", cell: (c) => <Badge tone={c.getValue() ? "brand" : "neutral"}>{c.getValue() ? "System" : "Custom"}</Badge> },
  ];
  return <DataTable columns={cols} data={data} rowHref={(r) => `/org/roles/${r.id}`} searchPlaceholder="Search roles…" />;
}

type Store = M.StoreBase & { managers?: { id: string; name: string; email: string }[] };
export function StoresTable({ data }: { data: Store[] }) {
  const cols: Row<Store> = [
    { accessorKey: "code", header: "Code", cell: (c) => mono(c.getValue() as string) },
    { accessorKey: "name", header: "Store", cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { accessorKey: "city", header: "Address" },
    { id: "manager", header: "Store manager", accessorFn: (r) => (r.managers ?? []).map((m) => m.name).join(", "), cell: (c) => { const v = c.getValue() as string; return v ? <span>{v}</span> : <Badge tone="warning">No manager assigned</Badge>; } },
    { accessorKey: "registers", header: "Registers", cell: (c) => { const n = c.getValue() as number; return n > 0 ? num(n) : <Badge tone="warning">None: cannot sell</Badge>; } },
    { accessorKey: "staff", header: "Staff", cell: (c) => num(c.getValue() as number) },
    { accessorKey: "status", header: "Status", cell: (c) => <StatusBadge status={c.getValue() as string} /> },
  ];
  return <DataTable columns={cols} data={data} rowHref={(r) => `/org/stores/${r.id}`} searchPlaceholder="Search stores or managers…" emptyTitle="No stores yet" emptyDescription="Create your first store to start trading." />;
}

type Product = Omit<M.Product, "status"> & { status: string; description?: string; attributes?: Record<string, string | number | boolean>; productId?: string; categoryId?: string | null; brand?: string; productTypeName?: string; costMinor?: number; uomCode?: string | null; openPrice?: boolean; floorPriceCents?: number; includesTax?: boolean; customFields?: Record<string, string | number | boolean> };
type ProductFilterOption = { id: string; name: string };
export function ProductsTable({ data, categories, brands, stores, selectedStoreId, productTypes = [], customFieldDefinitions = [], coreFields }: {
  data: Product[];
  categories: ProductFilterOption[];
  brands: ProductFilterOption[];
  stores: { id: string; name: string; code: string }[];
  selectedStoreId?: string;
  productTypes?: ProductFilterOption[];
  customFieldDefinitions?: ConfiguredField[];
  coreFields?: string[];
}) {
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [productTypeName, setProductTypeName] = useState("");
  const [storeAssignment, setStoreAssignment] = useState<"" | "IN_STORE" | "NOT_IN_STORE">("");
  const [status, setStatus] = useState("");
  const filtered = useMemo(() => filterCatalogProducts(data, { categoryId: category, brand, productTypeName, status, ...(storeAssignment ? { storeAssignment } : {}) }), [data, category, brand, productTypeName, status, storeAssignment]);
  const visibleCore = coreFields ?? ["name", "description", "productType", "attributes", "brand", "category", "sku", "barcode", "price", "cost", "uom", "status", "openPrice", "floorPrice", "includesTax"];
  const cols: Row<Product> = [
    ...(visibleCore.includes("sku") ? [{ accessorKey: "sku", header: "SKU", cell: (c) => mono(c.getValue() as string) } as ColumnDef<Product, unknown>] : []),
    { accessorKey: "name", header: "Product", cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    ...(visibleCore.includes("description") ? [{ accessorKey: "description", header: "Description", cell: (c) => <span className="max-w-56 truncate text-muted-foreground">{(c.getValue() as string) || "—"}</span> } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("category") ? [{ accessorKey: "category", header: "Category" } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("productType") ? [{ accessorKey: "productTypeName", header: "Product version", cell: (c) => (c.getValue() as string) || "—" } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("attributes") ? [{ id: "attributes", header: "Rule attributes", accessorFn: (row) => Object.values(row.attributes ?? {}).join(" · ") || "—" } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("brand") ? [{ accessorKey: "brand", header: "Brand" } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("barcode") ? [{ accessorKey: "barcode", header: "Barcode", cell: (c) => mono(c.getValue() as string) } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("price") ? [{ accessorKey: "priceMinor", header: "Price", cell: (c) => <Money minor={c.getValue() as number} /> } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("cost") ? [{ accessorKey: "costMinor", header: "Cost", cell: (c) => <Money minor={c.getValue() as number} /> } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("uom") ? [{ accessorKey: "uomCode", header: "Unit", cell: (c) => (c.getValue() as string) || "—" } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("openPrice") ? [{ accessorKey: "openPrice", header: "Open price", cell: (c) => c.getValue() ? "Allowed" : "Fixed" } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("floorPrice") ? [{ accessorKey: "floorPriceCents", header: "Minimum price", cell: (c) => <Money minor={c.getValue() as number} /> } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("includesTax") ? [{ accessorKey: "includesTax", header: "Price includes tax", cell: (c) => c.getValue() ? "Yes" : "No" } as ColumnDef<Product, unknown>] : []),
    ...customFieldDefinitions.filter((field) => field.active && field.showInList).map((field): ColumnDef<Product, unknown> => ({ id: `custom-${field.key}`, header: field.label, accessorFn: (row) => row.customFields?.[field.key] ?? "—" })),
    ...(selectedStoreId ? [{ accessorKey: "stock", header: "Stock", cell: (c) => num(c.getValue() as number) } as ColumnDef<Product, unknown>] : []),
    ...(selectedStoreId ? [{ accessorKey: "inStore", header: "In store", cell: (c) => c.getValue() ? <StatusBadge status="ACTIVE" /> : <span className="text-xs text-muted-foreground">Not sold here</span> } as ColumnDef<Product, unknown>] : []),
    ...(visibleCore.includes("status") ? [{ accessorKey: "status", header: "Status", cell: (c) => <StatusBadge status={c.getValue() as string} /> } as ColumnDef<Product, unknown>] : []),
  ];
  const toolbar = <div className="flex flex-wrap items-center gap-2" aria-label="Product filters">
    <FilterBar filters={[
      ...(visibleCore.includes("category") ? [{ key: "category", label: "Category", allLabel: "All categories", value: category, onChange: setCategory, options: categories.map((item) => ({ value: item.id, label: item.name })) }] : []),
      ...(visibleCore.includes("productType") ? [{ key: "type", label: "Product version", allLabel: "All versions", value: productTypeName, onChange: setProductTypeName, options: productTypes.map((item) => ({ value: item.name, label: item.name })) }] : []),
      ...(visibleCore.includes("brand") ? [{ key: "brand", label: "Brand", allLabel: "All brands", value: brand, onChange: setBrand, options: brands.map((item) => ({ value: item.name, label: item.name })) }] : []),
      ...(selectedStoreId ? [{ key: "store", label: "Store assignment", allLabel: "All products", value: storeAssignment, onChange: (value: string) => setStoreAssignment(value as "" | "IN_STORE" | "NOT_IN_STORE"), options: [{ value: "IN_STORE", label: "In this store" }, { value: "NOT_IN_STORE", label: "Not in this store" }] }] : []),
      ...(visibleCore.includes("status") ? [{ key: "status", label: "Status", allLabel: "All statuses", value: status, onChange: setStatus, options: ["ACTIVE", "DRAFT", "SEASONAL", "DISCONTINUED", "BLOCKED"].map((item) => ({ value: item, label: item.charAt(0) + item.slice(1).toLowerCase() })) }] : []),
    ]} />
    <form action="/org/catalog/products" method="get" className="flex items-center gap-1.5 text-xs text-muted-foreground"><label htmlFor="stock-store">Stock in</label><NativeSelect id="stock-store" className="h-8 w-auto text-sm" aria-label="Stock store" name="storeId" value={selectedStoreId ?? ""} disabled={stores.length === 0} onChange={(event) => event.currentTarget.form?.requestSubmit()}><option value="" disabled>Select store</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name} ({store.code})</option>)}</NativeSelect></form>
  </div>;
  const initialVisibility = Object.fromEntries(["description", "productTypeName", "attributes", "brand", "barcode", "costMinor", "uomCode", "openPrice", "floorPriceCents", "includesTax"].map((key) => [key, false]));
  return <DataTable columns={cols} data={filtered} rowHref={(r) => `/org/catalog/products/${r.productId ?? r.id}`} toolbar={toolbar} initialVisibility={initialVisibility} searchPlaceholder="Search product name, SKU or barcode…" />;
}

type Named = { id: string; name: string; products: number };
export function NamedTable({ data, noun }: { data: Named[]; noun: string }) {
  const cols: Row<Named> = [
    { accessorKey: "name", header: noun, cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { accessorKey: "products", header: "Products", cell: (c) => num(c.getValue() as number) },
  ];
  return <DataTable columns={cols} data={data} searchPlaceholder={`Search ${noun.toLowerCase()}…`} />;
}

type Tax = M.TaxGroupRow;
export function TaxTable({ data }: { data: Tax[] }) {
  const cols: Row<Tax> = [
    { accessorKey: "name", header: "Tax group", cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { accessorKey: "rate", header: "Rate", cell: (c) => <span className="tabular">{c.getValue() as number}%</span> },
    { accessorKey: "products", header: "Variants using it", cell: (c) => num(c.getValue() as number) },
    { id: "actions", header: "", cell: (c) => <div className="flex justify-end"><EditTaxGroupSheet id={c.row.original.id} name={c.row.original.name} rate={c.row.original.rate} /></div> },
  ];
  return <DataTable columns={cols} data={data} searchPlaceholder="Search tax groups…" />;
}

type Customer = M.CustomerRow;
export function CustomersTable({ data }: { data: Customer[] }) {
  const cols: Row<Customer> = [
    { accessorKey: "name", header: "Customer", cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { accessorKey: "phone", header: "Phone" },
    { accessorKey: "tier", header: "Tier", cell: (c) => <Badge tone="brand">{c.getValue() as string}</Badge> },
    { accessorKey: "walletMinor", header: "Wallet", cell: (c) => <Money minor={c.getValue() as number} /> },
    { accessorKey: "lifetimeMinor", header: "Lifetime spend", cell: (c) => <Money minor={c.getValue() as number} /> },
    { accessorKey: "lastVisit", header: "Last visit", cell: (c) => when(c.getValue() as string) },
  ];
  return <DataTable columns={cols} data={data} rowHref={(r) => `/org/customers/${r.id}`} searchPlaceholder="Search name or phone…" />;
}

type Sale = M.SaleRow;
export function SalesTable({ data, storeId }: { data: Sale[]; storeId: string }) {
  const cols: Row<Sale> = [
    { accessorKey: "receipt", header: "Receipt", cell: (c) => mono(c.getValue() as string) },
    { accessorKey: "at", header: "When", cell: (c) => when(c.getValue() as string) },
    { accessorKey: "cashier", header: "Cashier" },
    { accessorKey: "register", header: "Register" },
    { accessorKey: "items", header: "Items", cell: (c) => num(c.getValue() as number) },
    { accessorKey: "tender", header: "Tender" },
    { accessorKey: "totalMinor", header: "Total", cell: (c) => <Money minor={c.getValue() as number} /> },
    { accessorKey: "status", header: "Status", cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { id: "invoice", header: "", cell: (c) => <a className="text-xs font-medium underline" href={`/api/proxy/pos/v1/sales/${c.row.original.id}/invoice.pdf?storeId=${encodeURIComponent(storeId)}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>PDF</a> },
  ];
  return <DataTable columns={cols} data={data} rowHref={(r) => `/s/${storeId}/sales/${r.id}`} searchPlaceholder="Search receipt or cashier…" />;
}

type Ret = M.ReturnRow;
export function ReturnsTable({ data }: { data: Ret[] }) {
  const cols: Row<Ret> = [
    { accessorKey: "number", header: "Credit note", cell: (c) => mono(c.getValue() as string) },
    { accessorKey: "receipt", header: "Original receipt", cell: (c) => mono(c.getValue() as string) },
    { accessorKey: "at", header: "When", cell: (c) => when(c.getValue() as string) },
    { accessorKey: "reason", header: "Reason" },
    { accessorKey: "method", header: "Refund to" },
    { accessorKey: "refundMinor", header: "Refund", cell: (c) => <Money minor={c.getValue() as number} /> },
    { accessorKey: "status", header: "Status", cell: (c) => <StatusBadge status={c.getValue() as string} /> },
  ];
  return <DataTable columns={cols} data={data} searchPlaceholder="Search credit note or receipt…" />;
}

type Inv = M.InventoryRow;
export function InventoryTable({ data, storeId, productTypes = [] }: { data: Inv[]; storeId: string; productTypes?: ProductVersionOption[] }) {
  const [productTypeId, setProductTypeId] = useState("");
  const cols: Row<Inv> = [
    { accessorKey: "sku", header: "SKU", cell: (c) => mono(c.getValue() as string) },
    { accessorKey: "name", header: "Product", cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { accessorKey: "productTypeName", header: "Product version", cell: (c) => (c.getValue() as string) || "—" },
    { accessorKey: "barcode", header: "Barcode" },
    { accessorKey: "onHand", header: "On hand", cell: (c) => num(c.getValue() as number) },
    { accessorKey: "reorderLevel", header: "Reorder level", cell: (c) => num(c.getValue() as number) },
    { accessorKey: "status", header: "Stock", cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { id: "actions", header: "", cell: (c) => { const r = c.row.original; return r.locationId && r.variantId ? <div className="flex justify-end"><ThresholdSheet storeId={storeId} locationId={r.locationId} variantId={r.variantId} name={r.name} reorderPoint={r.reorderLevel} /></div> : null; } },
  ];
  const urgency: Record<string, number> = { OUT: 0, LOW: 1 };
  const prioritized = [...data].sort((a, b) => (urgency[a.status] ?? 2) - (urgency[b.status] ?? 2) || a.onHand - b.onHand);
  const options = productTypes.length ? productTypes : [...new Map(data.flatMap((item) => item.productTypeId && item.productTypeName ? [[item.productTypeId, { id: item.productTypeId, name: item.productTypeName }] as const] : [])).values()];
  const visible = prioritized.filter((product) => !productTypeId || product.productTypeId === productTypeId);
  return <DataTable columns={cols} data={visible} toolbar={<ProductVersionFilter value={productTypeId} onChange={setProductTypeId} options={options} />} searchPlaceholder="Search product, SKU, barcode, or version…" emptyTitle="No stock records" emptyDescription="Stock will appear here after products are assigned to this store." />;
}

type Led = M.LedgerRow;
export function LedgerTable({ data }: { data: Led[] }) {
  const cols: Row<Led> = [
    { accessorKey: "at", header: "When", cell: (c) => when(c.getValue() as string) },
    { accessorKey: "name", header: "Product", cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    { accessorKey: "type", header: "Type", cell: (c) => <Badge>{c.getValue() as string}</Badge> },
    { accessorKey: "qty", header: "Qty", cell: (c) => { const v = c.getValue() as number; return <span className={`tabular font-medium ${v < 0 ? "text-danger" : "text-success"}`}>{v > 0 ? `+${v}` : v}</span>; } },
    { accessorKey: "ref", header: "Reference" },
  ];
  return <DataTable columns={cols} data={data} searchPlaceholder="Search ledger…" />;
}

type Reg = M.RegisterRow;
export function RegistersTable({ data, storeId, admin = false }: { data: Reg[]; storeId: string; admin?: boolean }) {
  const cols: Row<Reg> = [
    { accessorKey: "name", header: "Register", cell: (c) => <span className="font-medium">{c.getValue() as string}</span> },
    ...(admin ? [{ accessorKey: "code", header: "Code", cell: (c: { getValue: () => unknown }) => mono(String(c.getValue() ?? "")) }] as Row<Reg> : []),
    { accessorKey: "status", header: "Status", cell: (c) => c.row.original.registerStatus && c.row.original.registerStatus !== "ACTIVE" ? <StatusBadge status="INACTIVE" /> : <StatusBadge status={c.getValue() as string} /> },
    { accessorKey: "cashier", header: "Cashier" },
    { accessorKey: "openedAt", header: "Opened", cell: (c) => when(c.getValue() as string) },
    { accessorKey: "expectedMinor", header: "Expected cash", cell: (c) => <Money minor={c.getValue() as number} /> },
    ...(admin ? [{ id: "actions", header: "", cell: (c: { row: { original: Reg } }) => <RegisterAdminActions id={c.row.original.id} name={c.row.original.name} status={c.row.original.registerStatus ?? "ACTIVE"} /> }] as Row<Reg> : []),
  ];
  return <DataTable columns={cols} data={data} rowHref={admin ? undefined : (r) => (r.sessionId ? `/s/${storeId}/registers/${r.sessionId}` : `/s/${storeId}/registers`)} searchPlaceholder="Search registers…" />;
}

type Appr = M.ApprovalRow;
export function ApprovalsTable({ data, storeId }: { data: Appr[]; storeId: string }) {
  const cols: Row<Appr> = [
    { accessorKey: "at", header: "When", cell: (c) => when(c.getValue() as string) },
    { accessorKey: "type", header: "Type", cell: (c) => <Badge>{(c.getValue() as string).replaceAll("_", " ")}</Badge> },
    { accessorKey: "requestedBy", header: "Requested by" },
    { accessorKey: "detail", header: "Requested action", cell: (c) => { const row = c.row.original; const payload = row.payload && Object.keys(row.payload).length ? ` · ${Object.entries(row.payload).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ")}` : ""; return <span>{row.detail}{payload}</span>; } },
    { accessorKey: "status", header: "Status", cell: (c) => <StatusBadge status={c.getValue() as string} /> },
    { id: "actions", header: "", cell: (c) => <ApprovalButtons id={c.row.original.id} status={c.row.original.status} storeId={storeId} /> },
  ];
  return <DataTable columns={cols} data={data} searchPlaceholder="Search approvals…" />;
}

type Aud = M.AuditRow;
export function AuditTable({ data }: { data: Aud[] }) {
  const cols: Row<Aud> = [
    { accessorKey: "at", header: "When", cell: (c) => when(c.getValue() as string) },
    { accessorKey: "actor", header: "Actor" },
    { accessorKey: "action", header: "Action", cell: (c) => mono(c.getValue() as string) },
    { accessorKey: "entity", header: "Entity" },
    { accessorKey: "detail", header: "Detail" },
  ];
  return <DataTable columns={cols} data={data} searchPlaceholder="Search audit log…" />;
}

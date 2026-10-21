"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data/data-table";
import { Money, StatusBadge } from "@/components/data/primitives";
import { StoreProductActions } from "@/features/actions";
import { StoreStaffRoleSelect } from "@/features/store/store-staff-role-select";
import { StoreStaffAccountActions } from "@/features/store/store-staff-actions";
import { LocalizedText } from "@/components/i18n/localized-text";
import type * as M from "@/features/types";
import { useMemo, useState } from "react";
import { ProductVersionFilter } from "@/features/catalog/product-version-filter";
import { NativeSelect } from "@/components/ui/input";

type Staff = M.UserRow;
export function StoreStaffTable({ data, storeId, roleOptions = [], canManage = false }: { data: Staff[]; storeId: string; roleOptions?: { id: string; name: string }[]; canManage?: boolean }) {
  const columns: ColumnDef<Staff, unknown>[] = [
    { accessorKey: "name", header: "Name", cell: (cell) => <span className="font-medium">{cell.getValue() as string}</span> },
    { accessorKey: "email", header: "Email" },
    // One role column: editable where the viewer may change it, otherwise the role the person already holds (for example
    // one assigned from Team members), shown read-only so nobody is asked to pick it again.
    { accessorKey: "role", header: "Store role", cell: ({ row }) => {
      const staff = row.original;
      if (canManage && staff.roleEditable) return <StoreStaffRoleSelect key={`${staff.id}:${staff.storeRoleId ?? ""}`} storeId={storeId} userId={staff.id} initialRoleId={staff.storeRoleId ?? ""} roleOptions={roleOptions} />;
      const inherited = !staff.storeRoleName && (staff.organizationRoles?.length ?? 0) > 0;
      return <span className="grid"><span className="font-medium">{staff.role}</span>{canManage && staff.role !== "No store role" && <span className="text-xs text-muted-foreground"><LocalizedText value={inherited ? "Organisation-wide role" : "Assigned by the organisation"} /></span>}</span>;
    } },
    { accessorKey: "status", header: "Status", cell: (cell) => <StatusBadge status={cell.getValue() as string} /> },
    { accessorKey: "lastLogin", header: "Last sign-in" },
    ...(canManage ? [{ id: "accountActions", header: "Account", cell: ({ row }) => row.original.accountManageable ? <StoreStaffAccountActions storeId={storeId} userId={row.original.id} name={row.original.name} status={row.original.status} /> : <span className="text-xs text-muted-foreground"><LocalizedText value={"Managed by the organisation"} /></span> } as ColumnDef<Staff, unknown>] : []),
  ];
  return <DataTable columns={columns} data={data} searchPlaceholder="Search this store’s staff…" emptyTitle="No staff assigned" />;
}

export type StoreProduct = { id: string; sku: string; barcode: string; name: string; category: string; brand: string; priceMinor: number; taxLabel: string; storeTaxGroupId: string | null; stock: number; status: string; productTypeId?: string | null; productTypeName?: string; customFields?: Record<string, string | number | boolean> };
export function StoreProductsTable({ data, storeId, initialCategory = "", productTypes = [], displayFieldDefinitions = [], coreFields }: { data: StoreProduct[]; storeId: string; initialCategory?: string; productTypes?: { id: string; name: string }[]; displayFieldDefinitions?: import("@/features/settings/configurable-field-values").ConfiguredField[]; coreFields?: string[] }) {
  const [productTypeId, setProductTypeId] = useState("");
  const [category, setCategory] = useState(initialCategory);
  const filtered = useMemo(() => data.filter((product) => (!productTypeId || product.productTypeId === productTypeId) && (!category || product.category === category)), [data, productTypeId, category]);
  const visibleCore = coreFields ?? ["sku", "category", "brand", "price", "status"];
  const columns: ColumnDef<StoreProduct, unknown>[] = [
    ...(visibleCore.includes("sku") ? [{ accessorKey: "sku", header: "SKU" } as ColumnDef<StoreProduct, unknown>] : []),
    { accessorKey: "barcode", header: "Barcodes" },
    { accessorKey: "name", header: "Product", cell: (cell) => <span className="font-medium">{cell.getValue() as string}</span> },
    { accessorKey: "productTypeName", header: "Product version", cell: (cell) => (cell.getValue() as string) || "—" },
    ...(visibleCore.includes("category") ? [{ accessorKey: "category", header: "Category", cell: (cell) => (cell.getValue() as string) || "Uncategorised" } as ColumnDef<StoreProduct, unknown>] : []),
    ...(visibleCore.includes("brand") ? [{ accessorKey: "brand", header: "Brand", cell: (cell) => (cell.getValue() as string) || "—" } as ColumnDef<StoreProduct, unknown>] : []),
    ...(visibleCore.includes("price") ? [{ accessorKey: "priceMinor", header: "Base price", cell: (cell) => <Money minor={cell.getValue() as number} /> } as ColumnDef<StoreProduct, unknown>] : []),
    { accessorKey: "taxLabel", header: "Store tax" },
    { accessorKey: "stock", header: "Store stock" },
    ...displayFieldDefinitions.filter((field) => field.active && field.showInList).map((field): ColumnDef<StoreProduct, unknown> => ({ id: `custom-${field.key}`, header: field.label, accessorFn: (row) => row.customFields?.[field.key] ?? "—" })),
    ...(visibleCore.includes("status") ? [{ accessorKey: "status", header: "Status", cell: (cell) => <StatusBadge status={cell.getValue() as string} /> } as ColumnDef<StoreProduct, unknown>] : []),
    { id: "actions", header: "", cell: (cell) => <StoreProductActions storeId={storeId} variantId={cell.row.original.id} status={cell.row.original.status} /> },
  ];
  const options = productTypes.length ? productTypes : [...new Map(data.flatMap((item) => item.productTypeId && item.productTypeName ? [[item.productTypeId, { id: item.productTypeId, name: item.productTypeName }] as const] : [])).values()];
  const categories = [...new Set(data.map((product) => product.category).filter(Boolean))].sort();
  return <DataTable columns={columns} data={filtered} rowHref={(row) => `/s/${storeId}/products/${row.id}`} toolbar={<div className="flex flex-wrap gap-2"><ProductVersionFilter value={productTypeId} onChange={setProductTypeId} options={options} /><NativeSelect aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((name) => <option key={name} value={name}>{name}</option>)}</NativeSelect></div>} searchPlaceholder="Search product, SKU, barcode, or version…" emptyTitle="No products in this store yet" emptyDescription="Assign organization products to this store to get started." />;
}

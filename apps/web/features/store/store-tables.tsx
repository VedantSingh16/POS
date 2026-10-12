"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data/data-table";
import { Money, StatusBadge } from "@/components/data/primitives";
import { StoreProductActions } from "@/features/actions";
import type * as M from "@/features/types";

type Staff = M.UserRow;
export function StoreStaffTable({ data }: { data: Staff[] }) {
  const columns: ColumnDef<Staff, unknown>[] = [
    { accessorKey: "name", header: "Name", cell: (cell) => <span className="font-medium">{cell.getValue() as string}</span> },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "role", header: "Role" },
    { accessorKey: "status", header: "Status", cell: (cell) => <StatusBadge status={cell.getValue() as string} /> },
    { accessorKey: "lastLogin", header: "Last sign-in" },
  ];
  return <DataTable columns={columns} data={data} searchPlaceholder="Search this store’s staff…" emptyTitle="No staff assigned" />;
}

export type StoreProduct = { id: string; sku: string; name: string; category: string; brand: string; priceMinor: number; taxLabel: string; storeTaxGroupId: string | null; stock: number; status: string };
export function StoreProductsTable({ data, storeId, taxGroups }: { data: StoreProduct[]; storeId: string; taxGroups: { id: string; name: string; ratePercent: number }[] }) {
  const columns: ColumnDef<StoreProduct, unknown>[] = [
    { accessorKey: "sku", header: "SKU" },
    { accessorKey: "name", header: "Product", cell: (cell) => <span className="font-medium">{cell.getValue() as string}</span> },
    { accessorKey: "category", header: "Category", cell: (cell) => (cell.getValue() as string) || "Uncategorised" },
    { accessorKey: "brand", header: "Brand", cell: (cell) => (cell.getValue() as string) || "—" },
    { accessorKey: "priceMinor", header: "Base price", cell: (cell) => <Money minor={cell.getValue() as number} /> },
    { accessorKey: "taxLabel", header: "Tax" },
    { accessorKey: "stock", header: "Store stock" },
    { accessorKey: "status", header: "Status", cell: (cell) => <StatusBadge status={cell.getValue() as string} /> },
    { id: "actions", header: "", cell: (cell) => <StoreProductActions storeId={storeId} variantId={cell.row.original.id} status={cell.row.original.status} storeTaxGroupId={cell.row.original.storeTaxGroupId} taxGroups={taxGroups} /> },
  ];
  return <DataTable columns={columns} data={data} searchPlaceholder="Search this store’s products…" emptyTitle="No products in this store yet" emptyDescription="Products sent by the organisation appear under Pending until you add them." />;
}

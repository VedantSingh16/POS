import { requirePermission } from "@/lib/server/session";
import Link from "next/link";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { NewProductSheet } from "@/features/catalog/record-forms";
import { ProductsTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: PageProps<"/org/catalog/products">) {
  await requirePermission("catalog.view");
  const params = await searchParams;
  const [{ data: stores }, { data: categories }, { data: brands }, { data: taxGroups }] = await Promise.all([
    api.stores(), api.categories(), api.brands(), api.taxGroups(),
  ]);
  const requestedStoreId = typeof params.storeId === "string" ? params.storeId : undefined;
  const selectedStoreId = stores.some((store) => store.id === requestedStoreId)
    ? requestedStoreId
    : stores[0]?.id;
  const [{ data: catalogue }, storeItems] = await Promise.all([api.products(), selectedStoreId ? api.storeCatalogue(selectedStoreId).then((r) => r.data) : Promise.resolve([])]);
  const byVariant = new Map(storeItems.map((item) => [item.variantId, item]));
  // Whole organisation catalogue; stock and the "In store" flag come from the selected store.
  const data = catalogue.map((row) => { const item = byVariant.get(row.variantId ?? row.id); return { ...row, stock: item?.stock ?? 0, inStore: !!item?.assigned && item.status === "ACTIVE" }; });
  return (
    <>
      <PageHeader title="Products" description="Every product in the organisation. Stock and “In store” show the selected store; each store sells its own set." crumbs={[{ label: "Catalogue" }, { label: "Products" }]}
        actions={<><Link href="/org/catalog/import" className={buttonVariants({ variant: "outline" })}><Upload /> Import</Link><NewProductSheet stores={stores.map((store) => ({ id: store.id, name: store.name, code: store.code }))} taxGroups={taxGroups.map((tax) => ({ id: tax.id, name: tax.name, ratePercent: tax.rate }))} brands={brands.map((b) => ({ id: b.id, name: b.name }))} categories={categories.map((c) => ({ id: c.id, name: c.name }))} /></>} />
      <ProductsTable data={data} categories={categories} brands={brands} taxGroups={taxGroups} stores={stores} selectedStoreId={selectedStoreId} />
    </>
  );
}

import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import Link from "next/link";
import { SlidersHorizontal, Upload } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { buttonVariants } from "@/components/ui/button";
import { NewProductSheet } from "@/features/catalog/record-forms";
import { ProductsTable } from "@/features/tables";
import { api } from "@/features/api";
import type { ConfiguredField } from "@/features/settings/configurable-field-values";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Products") }; }

export default async function ProductsPage({ searchParams }: PageProps<"/org/catalog/products">) {
  await requirePermission("catalog.view");
  const params = await searchParams;
  const [{ data: stores }, { data: categories }, { data: brands }, { data: productTypes }, { data: settings }] = await Promise.all([
    api.stores(), api.categories(), api.brands(), api.productTypes(), api.settings(),
  ]);
  const requestedStoreId = typeof params.storeId === "string" ? params.storeId : undefined;
  const selectedStoreId = stores.some((store) => store.id === requestedStoreId)
    ? requestedStoreId
    : stores[0]?.id;
  const [{ data: catalogue }, storeItems] = await Promise.all([api.products(), selectedStoreId ? api.storeCatalogue(selectedStoreId).then((r) => r.data) : Promise.resolve([])]);
  const productFieldSet = settings.productFields as { fields?: ConfiguredField[]; coreFields?: string[] } | undefined;
  const byVariant = new Map(storeItems.map((item) => [item.variantId, item]));
  // Whole organisation catalogue; stock and the "In store" flag come from the selected store.
  const data = catalogue.map((row) => { const item = byVariant.get(row.variantId ?? row.id); return { ...row, stock: item?.stock ?? 0, inStore: !!item?.assigned && item.status === "ACTIVE" }; });
  return (
    <>
      <PageHeader title="Product catalogue" description="The organisation defines products and variants. Stores accept products before selling them. Choose a store to see its stock and assignments; use Columns to view the product fields you need." crumbs={[{ label: "Catalogue" }, { label: "Products" }]}
        actions={<><Link href="/org/catalog/setup" className={buttonVariants({ variant: "outline" })}><SlidersHorizontal /> <LocalizedText value={"Catalogue setup"} /></Link><Link href="/org/catalog/import" className={buttonVariants({ variant: "outline" })}><Upload /> <LocalizedText value={"Import"} /></Link><NewProductSheet productFields={productFieldSet ? { ...productFieldSet, fields: productFieldSet.fields ?? [] } : undefined} productTypes={productTypes} stores={stores.map((store) => ({ id: store.id, name: store.name, code: store.code }))} brands={brands.map((b) => ({ id: b.id, name: b.name }))} categories={categories.map((c) => ({ id: c.id, name: c.name }))} /></>} />
      <ProductsTable data={data} categories={categories} brands={brands} stores={stores} selectedStoreId={selectedStoreId} productTypes={productTypes.map((type) => ({ id: type.id, name: type.name }))} customFieldDefinitions={productFieldSet?.fields} coreFields={productFieldSet?.coreFields} />
    </>
  );
}

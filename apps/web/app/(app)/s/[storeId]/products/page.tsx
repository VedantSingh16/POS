import { PageHeader } from "@/components/app/page-header";
import { StoreProductsTable } from "@/features/store/store-tables";
import { AddStoreProductsSheet, NewStoreProductSheet, PendingVerificationList } from "@/features/actions";
import { api, soft } from "@/features/api";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/server/session";
import type * as M from "@/features/types";

export const metadata = { title: "Store products" };

export default async function StoreProducts({ params }: PageProps<"/s/[storeId]/products">) {
  const { storeId } = await params;
  const me = await requirePermission("catalog.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const canManageStore = hasPermission(me, "catalog.manage.store", storeId);
  const canManageOrg = hasPermission(me, "catalog.manage", storeId);
  const canVerify = hasPermission(me, "store-catalog.verify", storeId);
  // Every request below is independent: one failing (or not permitted) must not blank the page.
  const problems: string[] = [];
  const note = (message: string) => problems.push(message);
  const [{ data }, { data: pending }, { data: taxGroups }, { data: lookups }] = await Promise.all([
    soft<M.StoreCatalogueItem[]>(api.storeCatalogue(storeId), [], note),
    canVerify ? soft(api.storePending(storeId), [], note) : Promise.resolve({ data: [] as Awaited<ReturnType<typeof api.storePending>>["data"] }),
    soft(api.storeTaxGroups(storeId), [], note),
    soft(api.storeLookups(storeId), { categories: [], brands: [] }, note),
  ]);
  const taxOptions = taxGroups.map((t) => ({ id: t.id, name: t.name, ratePercent: t.ratePercent }));
  const rows = data.filter((item) => item.assigned && item.status === "ACTIVE").map((item) => ({
    id: item.variantId, sku: item.sku, name: item.name, category: item.category, brand: item.brand, priceMinor: item.priceCents,
    taxLabel: item.taxGroupName ? `${item.taxGroupName} · ${item.taxRatePercent}%` : "No tax", storeTaxGroupId: item.storeTaxGroupId, stock: item.stock, status: item.status ?? "ACTIVE",
  }));
  return (
    <>
      <PageHeader
        title="Products"
        description="What this store sells. Base prices are set by the organisation; this store can choose tax groups and add extra charges."
        crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: store?.name ?? "Products" }, { label: "Products" }]}
        actions={<div className="flex gap-2">
          {canManageStore && <NewStoreProductSheet storeId={storeId} taxGroups={taxOptions} brands={lookups.brands} categories={lookups.categories} />}
          {canManageOrg && <AddStoreProductsSheet storeId={storeId} items={data} />}
        </div>}
      />
      {problems.length > 0 && <p role="alert" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Part of this page could not be loaded ({problems[0]}). The rest is shown below.</p>}
      {canVerify && pending.length > 0 && (
        <section className="mb-6 rounded-md border bg-warning-soft p-4">
          <div className="mb-3">
            <h2 className="font-semibold">Pending from the organisation ({pending.length})</h2>
            <p className="text-sm text-muted-foreground">Products and stock sent to this store. Choose <b>Add to store</b> to put them on sale; their category and brand are added to the store automatically.</p>
          </div>
          <PendingVerificationList storeId={storeId} items={pending} taxGroups={taxOptions.map((t) => ({ id: t.id, name: t.name, rate: t.ratePercent }))} />
        </section>
      )}
      <StoreProductsTable storeId={storeId} data={rows} taxGroups={taxOptions} />
    </>
  );
}

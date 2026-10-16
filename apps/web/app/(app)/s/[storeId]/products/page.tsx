import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { PageHeader } from "@/components/app/page-header";
import { StoreProductsTable } from "@/features/store/store-tables";
import { AddStoreProductsSheet, PendingVerificationList } from "@/features/actions";
import { api, soft } from "@/features/api";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/server/session";
import type * as M from "@/features/types";
import type { ConfiguredField } from "@/features/settings/configurable-field-values";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Store products") }; }

export default async function StoreProducts({ params }: PageProps<"/s/[storeId]/products">) {
  const { storeId } = await params;
  const me = await requirePermission("catalog.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const canManageStore = hasPermission(me, "catalog.manage.store", storeId);
  const canVerify = hasPermission(me, "store-catalog.verify", storeId);
  const canViewPending = hasPermission(me, "catalog.view", storeId);
  const canViewSettings = hasPermission(me, "store.settings.view", storeId);
  // Every request below is independent: one failing (or not permitted) must not blank the page.
  const problems: string[] = [];
  const note = (message: string) => problems.push(message);
  const [{ data }, { data: pending }, { data: taxGroups }, { data: storeSettings }] = await Promise.all([
    soft<M.StoreCatalogueItem[]>(api.storeCatalogue(storeId), [], note),
    canViewPending ? soft(api.storePending(storeId), [], note) : Promise.resolve({ data: [] as Awaited<ReturnType<typeof api.storePending>>["data"] }),
    soft(api.storeTaxGroups(storeId), [], note),
    canViewSettings ? soft(api.storeSettings(storeId), {} as Awaited<ReturnType<typeof api.storeSettings>>, note) : Promise.resolve({ data: {} as Awaited<ReturnType<typeof api.storeSettings>>["data"] }),
  ]);
  const taxOptions = taxGroups.map((t) => ({ id: t.id, name: t.name, ratePercent: t.ratePercent }));
  const productTypes = [...new Map(data.flatMap((item) => item.productTypeId && item.productTypeName ? [[item.productTypeId, { id: item.productTypeId, name: item.productTypeName }] as const] : [])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const rows = data.filter((item) => item.assigned && item.status === "ACTIVE").map((item) => ({
    id: item.variantId, sku: item.sku, barcode: (item.barcodes ?? []).join(", "), name: item.name, category: item.category, brand: item.brand, priceMinor: item.priceCents,
    taxLabel: item.taxGroupName ? `${item.taxGroupName} · ${item.taxRatePercent}%` : "No tax", storeTaxGroupId: item.storeTaxGroupId, stock: item.stock, status: item.status ?? "ACTIVE",
    productTypeId: item.productTypeId, productTypeName: item.productTypeName,
    customFields: item.customFields ?? {},
  }));
  const productConfig = storeSettings.effectiveProductFields ?? [];
  const displayFields = productConfig as ConfiguredField[];
  return (
    <>
      <PageHeader
        title="Products"
        description="Products and product fields come from the organization catalog. Assign them here, manage store availability, and track stock."
        crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: store?.name ?? "Products" }, { label: "Products" }]}
        actions={<div className="flex gap-2">
          {canManageStore && <AddStoreProductsSheet storeId={storeId} items={data} />}
        </div>}
      />
      {problems.length > 0 && <p role="alert" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><LocalizedText value={"Part of this page could not be loaded ("} />{problems[0]}<LocalizedText value={"). The rest is shown below."} /></p>}
      {pending.length > 0 && (
        <section className="mb-6 rounded-md border bg-warning-soft p-4">
          <div className="mb-3">
            <h2 className="font-semibold"><LocalizedText value={"Pending from the organisation ("} />{pending.length})</h2>
            <p className="text-sm text-muted-foreground"><LocalizedText value={"Products and stock sent to this store are held here until a store manager reviews them."} /><LocalizedText value={canVerify ? " Accepted products become available for sale; their category and brand are added to the store automatically." : " This organisation view can see their status but cannot accept or reject them."} /></p>
          </div>
          <PendingVerificationList storeId={storeId} items={pending} taxGroups={taxOptions.map((t) => ({ id: t.id, name: t.name, rate: t.ratePercent }))} canReview={canVerify} />
        </section>
      )}
      <StoreProductsTable storeId={storeId} data={rows} productTypes={productTypes} displayFieldDefinitions={displayFields} coreFields={storeSettings.effectiveProductCoreFields} />
    </>
  );
}

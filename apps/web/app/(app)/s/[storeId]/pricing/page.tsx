import { PageHeader } from "@/components/app/page-header";
import { OffersAndRules } from "@/features/pricing/offers-and-rules";
import { api, soft } from "@/features/api";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Offers & price rules" };
export default async function StoreOffers({ params }: PageProps<"/s/[storeId]/pricing">) {
  const { storeId } = await params;
  const me = await requirePermission("pricing.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const problems: string[] = [];
  const [{ data: rules }, { data: reasons }, { data: promotions }, { data: lookups }, { data: catalogue }] = await Promise.all([
    soft(api.priceRules(storeId), [], (message) => problems.push(message)),
    soft(api.discountReasons(storeId), [], (message) => problems.push(message)),
    soft(api.promotions(storeId), [], (message) => problems.push(message)),
    soft(api.storeLookups(storeId), { categories: [], brands: [] }, (message) => problems.push(message)),
    soft(api.storeCatalogue(storeId), [], (message) => problems.push(message)),
  ]);
  const canManage = hasPermission(me, "pricing.manage", storeId);
  const products = catalogue.filter((item) => item.assigned && item.status === "ACTIVE").map((item) => ({ id: item.variantId, name: `${item.name} · ${item.sku}` }));
  return <>
    <PageHeader title="Offers & price rules" description="Manage this store’s coupons, automatic offers, price rules, and discount reasons." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: store?.name ?? "Store" }, { label: "Offers & price rules" }]} />
    {problems.length > 0 && <p role="alert" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Some store pricing settings could not be loaded: {problems[0]}</p>}
    <OffersAndRules storeId={storeId} canManage={canManage} rules={rules} reasons={reasons} promotions={promotions} categories={lookups.categories} brands={lookups.brands} products={products} />
  </>;
}

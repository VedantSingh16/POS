import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { PageHeader } from "@/components/app/page-header";
import { NamedTable } from "@/features/tables";
import { api, soft } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Store categories") }; }

export default async function Page({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const me = await requirePermission("catalog.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const problems: string[] = [];
  const { data } = await soft(api.storeTaxonomy(storeId), { categories: [], brands: [] }, (m) => problems.push(m));
  const rows = data.categories.map((item) => ({ id: item.id ?? item.name, name: item.name, products: item.products }));
  return (
    <>
      <PageHeader title="Categories" description="Listed automatically from the products this store sells. When you add a product sent by the organisation, its category and brand appear here." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: store?.name ?? "Store" }, { label: "Categories" }]} />
      {problems[0] && <p role="alert" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><LocalizedText value={"Could not load: "} />{problems[0]}</p>}
      <NamedTable data={rows} noun="Category" />
    </>
  );
}

import { PageHeader } from "@/components/app/page-header";
import { NamedTable } from "@/features/tables";
import { api, soft } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Store categories" };

export default async function Page({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const me = await requirePermission("catalog.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  let problem = "";
  const { data } = await soft(api.storeTaxonomy(storeId), { categories: [], brands: [] }, (m) => { problem = m; });
  const rows = data.categories.map((item) => ({ id: item.id ?? item.name, name: item.name, products: item.products }));
  return (
    <>
      <PageHeader title="Categories" description="Listed automatically from the products this store sells. When you add a product sent by the organisation, its category and brand appear here." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: store?.name ?? "Store" }, { label: "Categories" }]} />
      {problem && <p role="alert" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Could not load: {problem}</p>}
      <NamedTable data={rows} noun="Category" />
    </>
  );
}

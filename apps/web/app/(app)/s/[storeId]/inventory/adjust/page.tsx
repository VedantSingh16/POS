import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { AdjustStockForm } from "@/features/adjust-form";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Adjust stock") }; }

export default async function Adjust({ params }: PageProps<"/s/[storeId]/inventory/adjust">) {
  const { storeId } = await params;
  await requirePermission("inventory.manage", storeId);
  const [{ data: catalogue }, { data: locations }] = await Promise.all([api.storeCatalogue(storeId), api.locations(storeId)]);
  const items = catalogue.filter((item) => item.assigned && item.status === "ACTIVE");
  return (
    <>
      <PageHeader title="Adjust stock" description="Record a count correction, damage or receipt for products in this store’s catalogue." crumbs={[{ label: "Inventory", href: `/s/${storeId}/inventory` }, { label: "Adjust" }]} backHref={`/s/${storeId}/inventory`} backLabel="Back to inventory" />
      <AdjustStockForm items={items.map((item) => ({ id: item.variantId, sku: item.sku, name: item.name }))} locations={locations} storeId={storeId} />
    </>
  );
}

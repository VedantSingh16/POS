import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { OpeningStockWizard } from "@/features/inventory/opening-stock-wizard";

export const metadata = { title: "Opening stock" };

export default async function Page({ params }: PageProps<"/s/[storeId]/inventory/opening-stock">) {
  const { storeId } = await params;
  await requirePermission("inventory.manage", storeId);
  return <><PageHeader title="Opening stock" description="Load initial quantities before trading begins." crumbs={[{ label: "Inventory", href: `/s/${storeId}/inventory` }, { label: "Opening stock" }]} backHref={`/s/${storeId}/inventory`} backLabel="Back to inventory" /><OpeningStockWizard storeId={storeId} /></>;
}

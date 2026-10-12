import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { LedgerTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Stock ledger" };

export default async function Page({ params }: PageProps<"/s/[storeId]/inventory/ledger">) {
  const { storeId } = await params;
  await requirePermission("inventory.view", storeId);
  const { data } = await api.ledger(storeId);
  return (
    <>
      <PageHeader title="Stock ledger" description="Every stock movement, newest first." crumbs={[{ label: "Inventory", href: `/s/${storeId}/inventory` }, { label: "Ledger" }]} />
      <LedgerTable data={data} />
    </>
  );
}

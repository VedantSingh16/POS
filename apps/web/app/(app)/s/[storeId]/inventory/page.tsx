import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { InventoryTable } from "@/features/tables";
import { api } from "@/features/api";
import { NewLocationSheet, RebuildStockButton } from "@/features/actions";

export const metadata = { title: "Inventory" };

export default async function Page({ params }: PageProps<"/s/[storeId]/inventory">) {
  const { storeId } = await params;
  await requirePermission("inventory.view", storeId);
  const { data } = await api.inventory(storeId);
  return (
    <>
      <PageHeader title="Inventory" description="Stock on hand in this store." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Inventory" }]} actions={<><NewLocationSheet storeId={storeId} /><RebuildStockButton storeId={storeId} /><Link href={`/s/${storeId}/inventory/ledger`} className={buttonVariants({ variant: "outline" })}>Ledger</Link><Link href={`/s/${storeId}/inventory/opening-stock`} className={buttonVariants({ variant: "outline" })}>Opening stock</Link><Link href={`/s/${storeId}/inventory/adjust`} className={buttonVariants()}>Adjust stock</Link></>} />
      <InventoryTable data={data} storeId={storeId} />
    </>
  );
}

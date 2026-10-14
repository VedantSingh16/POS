import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { InventoryTable } from "@/features/tables";
import { api, soft } from "@/features/api";
import { NewLocationSheet, RebuildStockButton } from "@/features/actions";

export const metadata = { title: "Inventory" };

export default async function Page({ params }: PageProps<"/s/[storeId]/inventory">) {
  const { storeId } = await params;
  await requirePermission("inventory.view", storeId);
  const [{ data: balances }, { data: catalogue }] = await Promise.all([api.inventory(storeId), soft(api.storeCatalogue(storeId), [])]);
  const byVariant = new Map(catalogue.map((item) => [item.variantId, item]));
  const data = balances.map((row) => ({ ...row, productTypeId: byVariant.get(row.variantId ?? "")?.productTypeId ?? null, productTypeName: byVariant.get(row.variantId ?? "")?.productTypeName ?? "" }));
  const productTypes = [...new Map(catalogue.flatMap((item) => item.productTypeId && item.productTypeName ? [[item.productTypeId, { id: item.productTypeId, name: item.productTypeName }] as const] : [])).values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PageHeader title="Inventory" description="Stock on hand in this store." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Inventory" }]} actions={<><NewLocationSheet storeId={storeId} /><RebuildStockButton storeId={storeId} /><Link href={`/s/${storeId}/inventory/ledger`} className={buttonVariants({ variant: "outline" })}>Ledger</Link><Link href={`/s/${storeId}/inventory/opening-stock`} className={buttonVariants({ variant: "outline" })}>Opening stock</Link><Link href={`/s/${storeId}/inventory/adjust`} className={buttonVariants()}>Adjust stock</Link></>} />
      <InventoryTable data={data} storeId={storeId} productTypes={productTypes} />
    </>
  );
}

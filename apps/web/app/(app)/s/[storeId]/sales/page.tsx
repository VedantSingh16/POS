import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { SalesTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Sales" };

export default async function Page({ params }: PageProps<"/s/[storeId]/sales">) {
  const { storeId } = await params;
  await requirePermission("sale.create", storeId);
  const { data } = await api.sales(storeId);
  return (
    <>
      <PageHeader title="Sales" description="Completed, voided and returned receipts." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Sales" }]} />
      <SalesTable data={data} storeId={storeId} />
    </>
  );
}

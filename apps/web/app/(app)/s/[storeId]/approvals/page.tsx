import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { ApprovalsTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Approvals" };

export default async function Page({ params }: PageProps<"/s/[storeId]/approvals">) {
  const { storeId } = await params;
  await requirePermission("approval.manage", storeId);
  const { data } = await api.approvals(storeId);
  return (
    <>
      <PageHeader title="Approvals" description="Controlled actions waiting for a decision." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Approvals" }]} />
      <ApprovalsTable data={data} storeId={storeId} />
    </>
  );
}

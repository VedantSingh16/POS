import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { ReturnForm } from "@/features/returns/return-form";
import { api } from "@/features/api";

export const metadata = { title: "New return" };

export default async function NewReturn({ params }: PageProps<"/s/[storeId]/returns/new">) {
  const { storeId } = await params;
  await requirePermission("refund.create", storeId);
  const { data: registers } = await api.registers(storeId);
  const sessions = registers.filter((register) => register.sessionId).map((register) => ({ id: register.sessionId, registerName: register.name }));
  return (
    <>
      <PageHeader title="New return" description="Find the original receipt first." crumbs={[{ label: "Returns", href: `/s/${storeId}/returns` }, { label: "New" }]} />
      <ReturnForm storeId={storeId} sessions={sessions} />
    </>
  );
}

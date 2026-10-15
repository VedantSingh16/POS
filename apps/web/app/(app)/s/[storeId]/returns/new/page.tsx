import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { ReturnForm } from "@/features/returns/return-form";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("New return") }; }

export default async function NewReturn({ params }: PageProps<"/s/[storeId]/returns/new">) {
  const { storeId } = await params;
  await requirePermission("refund.create", storeId);
  const { data: registers } = await api.registers(storeId);
  const sessions = registers.filter((register) => register.sessionId).map((register) => ({ id: register.sessionId, registerName: register.name }));
  return (
    <>
      <PageHeader title="New return" description="Find the original receipt first." crumbs={[{ label: "Returns", href: `/s/${storeId}/returns` }, { label: "New" }]} backHref={`/s/${storeId}/returns`} backLabel="Back to returns" />
      <ReturnForm storeId={storeId} sessions={sessions} />
    </>
  );
}

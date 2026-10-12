import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { api } from "@/features/api";
import { RegistersBoard } from "@/features/registers/register-actions";

export const metadata = { title: "Registers" };

export default async function Page({ params }: PageProps<"/s/[storeId]/registers">) {
  const { storeId } = await params;
  await requirePermission("registers.view", storeId);
  const { data } = await api.registers(storeId);
  return (
    <>
      <PageHeader title="Registers" description="Open a till to start a shift, then sell from the Point of sale." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Registers" }]} />
      <RegistersBoard storeId={storeId} registers={data.map((r) => ({ id: r.id, name: r.name, code: r.code, status: r.status, sessionId: r.sessionId, cashier: r.cashier, openedAt: r.openedAt, expectedMinor: r.expectedMinor, active: (r.registerStatus ?? "ACTIVE") === "ACTIVE" }))} />
    </>
  );
}

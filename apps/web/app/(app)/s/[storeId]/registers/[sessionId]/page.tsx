import { requirePermission } from "@/lib/server/session";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Money, StatusBadge } from "@/components/data/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/features/api";

export default async function RegisterSession({ params }: PageProps<"/s/[storeId]/registers/[sessionId]">) {
  const { storeId, sessionId } = await params;
  await requirePermission("registers.view", storeId);
  const { data: r } = await api.registerSession(sessionId, storeId);
  if (!r) notFound();
  return (
    <>
      <PageHeader title={`${r.name} session`} crumbs={[{ label: "Registers", href: `/s/${storeId}/registers` }, { label: r.name }]} backHref={`/s/${storeId}/registers`} backLabel="Back to registers" />
      <Card><CardContent className="grid gap-4 sm:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={r.status} /></div>
        <div><p className="text-xs text-muted-foreground">Cashier</p><p>{r.cashier}</p></div>
        <div><p className="text-xs text-muted-foreground">Expected cash</p><Money minor={r.expectedMinor} /></div>
      </CardContent></Card>
    </>
  );
}

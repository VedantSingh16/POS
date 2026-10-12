import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { AuditTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requirePermission("audit.view");
  const { data } = await api.audit();
  return (
    <>
      <PageHeader title="Audit log" description="Who changed what, and when." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Audit log" }]} />
      <AuditTable data={data} />
    </>
  );
}

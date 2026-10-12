import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ChargesList, NewChargeSheet } from "@/features/pricing/pricing-forms";
import { api } from "@/features/api";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Additional charges" };

export default async function Page() {
  const me = await requirePermission("pricing.view");
  const [{ data: charges }, { data: taxGroups }] = await Promise.all([api.charges(), api.taxGroups()]);
  const canManage = hasPermission(me, "pricing.manage");
  const taxOptions = taxGroups.map((t) => ({ id: t.id, name: t.name, ratePercent: t.rate }));
  return (
    <>
      <PageHeader title="Additional charges" description="Packaging, service or any extra amount added to a bill in every store. Each store can also add its own charges." crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Additional charges" }]} actions={canManage ? <NewChargeSheet taxGroups={taxOptions} /> : undefined} />
      <Card><CardContent className="p-0"><ChargesList charges={charges} taxGroups={taxOptions} canEdit={canManage} /></CardContent></Card>
    </>
  );
}

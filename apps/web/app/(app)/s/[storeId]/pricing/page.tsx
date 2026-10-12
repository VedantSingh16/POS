import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { ChargesList, NewChargeSheet, NewStoreTaxGroupSheet } from "@/features/pricing/pricing-forms";
import { api, soft } from "@/features/api";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Tax & charges" };

export default async function Page({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const me = await requirePermission("pricing.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const problems: string[] = [];
  const [{ data: taxGroups }, { data: charges }] = await Promise.all([
    soft(api.storeTaxGroups(storeId), [], (m) => problems.push(m)),
    soft(api.charges(storeId), [], (m) => problems.push(m)),
  ]);
  const canManage = hasPermission(me, "pricing.manage", storeId);
  const options = taxGroups.map((t) => ({ id: t.id, name: t.name, ratePercent: t.ratePercent }));
  return (
    <>
      <PageHeader title="Tax & charges" description="The base price is set by the organisation. This store can add its own tax groups and extra charges." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: store?.name ?? "Store" }, { label: "Tax & charges" }]} />
      {problems.length > 0 && <p role="alert" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Some information could not be loaded: {problems[0]}</p>}
      <section className="mb-8 grid gap-3">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Tax groups</h2><p className="text-sm text-muted-foreground">Choose one per product from Products → Tax. Organisation groups are available to every store.</p></div>{canManage && <NewStoreTaxGroupSheet storeId={storeId} />}</div>
        <div className="divide-y rounded-md border bg-card">
          {taxGroups.map((t) => <div key={t.id} className="flex items-center gap-3 p-3 text-sm"><span className="flex-1 font-medium">{t.name}</span><span className="tabular text-muted-foreground">{t.ratePercent}%</span><Badge tone={t.scope === "ORGANISATION" ? "brand" : "neutral"}>{t.scope === "ORGANISATION" ? "Organisation" : "This store"}</Badge></div>)}
          {taxGroups.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No tax groups yet.</p>}
        </div>
      </section>
      <section className="grid gap-3">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Additional charges</h2><p className="text-sm text-muted-foreground">Added to every bill in this store, together with the organisation’s charges.</p></div>{canManage && <NewChargeSheet storeId={storeId} taxGroups={options} />}</div>
        <ChargesList charges={charges} storeId={storeId} taxGroups={options} canEdit={canManage} />
      </section>
    </>
  );
}

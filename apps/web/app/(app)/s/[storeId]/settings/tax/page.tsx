import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { PageHeader } from "@/components/app/page-header";
import { ChargesList, NewChargeSheet, NewStoreTaxGroupSheet, StoreTaxAssignmentTable, StoreTaxGroupsList } from "@/features/pricing/pricing-forms";
import { api, soft } from "@/features/api";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/server/session";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Tax groups & charges") }; }
export default async function StoreTaxSettings({ params }: PageProps<"/s/[storeId]/settings/tax">) {
  const { storeId } = await params;
  const me = await requirePermission("tax.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const problems: string[] = [];
  const [{ data: groups }, { data: charges }, { data: catalogue }] = await Promise.all([
    soft(api.storeTaxGroups(storeId), [], (message) => problems.push(message)),
    soft(api.charges(storeId), [], (message) => problems.push(message)),
    soft(api.storeCatalogue(storeId), [], (message) => problems.push(message)),
  ]);
  const canManageTax = hasPermission(me, "tax.manage", storeId);
  const canManagePricing = hasPermission(me, "pricing.manage", storeId);
  const options = groups.filter((group) => group.status === "ACTIVE").map((group) => ({ id: group.id, name: group.name, ratePercent: group.ratePercent }));
  return <>
    <PageHeader title="Tax groups & charges" description="Tax rates and product assignments are owned by this store. These settings do not affect another store." crumbs={[{ label: "Settings", href: `/s/${storeId}/settings/profile` }, { label: store?.name ?? "Store" }, { label: "Tax groups" }]} />
    {problems.length > 0 && <p role="alert" className="mb-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><LocalizedText value={"Some settings could not be loaded: "} />{problems[0]}</p>}
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold"><LocalizedText value={"Tax groups"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={"Create local tax rates and HSN codes, then assign them to the products this store sells."} /></p></div>{canManageTax && <NewStoreTaxGroupSheet storeId={storeId} />}</div>
        <StoreTaxGroupsList storeId={storeId} groups={groups} canEdit={canManageTax} />
      </section>
      <section className="grid gap-3">
        <div><h2 className="font-semibold"><LocalizedText value={"Product tax assignments"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={"A registered store needs an active tax group on each product before it can sell that product."} /></p></div>
        <StoreTaxAssignmentTable storeId={storeId} items={catalogue.filter((item) => item.assigned && item.status === "ACTIVE")} groups={groups} canEdit={canManageTax} />
      </section>
      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold"><LocalizedText value={"Additional charges"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={"Packaging and service charges configured for this store only."} /></p></div>{canManagePricing && <NewChargeSheet storeId={storeId} taxGroups={options} />}</div>
        <ChargesList charges={charges} storeId={storeId} taxGroups={options} canEdit={canManagePricing} />
      </section>
    </div>
  </>;
}

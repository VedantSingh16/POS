import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { BillingForm } from "@/features/settings/billing-form";
import { StoreCheckoutFieldEditor } from "@/features/settings/field-configuration-editor";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";
import { hasPermission } from "@/lib/permissions";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Billing & checkout") }; }
export default async function StoreBillingSettings({ params }: PageProps<"/s/[storeId]/settings/billing">) {
  const { storeId } = await params;
  const me = await requirePermission("store.settings.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const { data } = await api.storeSettings(storeId);
  const canEdit = hasPermission(me, "store.settings.manage", storeId);
  return <>
    <PageHeader title="Billing & checkout" description="Set payment, discount, receipt, and checkout-field rules for this store." crumbs={[{ label: "Settings", href: `/s/${storeId}/settings/profile` }, { label: store?.name ?? "Store" }, { label: "Billing & checkout" }]} />
    <div className="grid gap-4">
      {!canEdit && <p role="status" className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm"><LocalizedText value={"You have view access to this store. To edit billing or checkout fields, ask an administrator to assign the Store Manager role or grant "} /><code>store.settings.manage</code> <LocalizedText value={"for this store."} /></p>}
      <nav aria-labelledby="billing-checkout-sections-label" className="grid gap-3 sm:grid-cols-2">
        <span id="billing-checkout-sections-label" className="sr-only"><LocalizedText value={"Billing and checkout sections"} /></span>
        <a href="#billing-behavior" className="group rounded-md border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="font-semibold"><LocalizedText value={"Billing behavior"} /></span><span className="mt-1 block text-sm text-muted-foreground"><LocalizedText value={"Payment methods, discounts, held bills, register controls, and receipts."} /></span><span className="mt-3 block text-sm font-medium text-primary"><LocalizedText value={"Configure billing ↓"} /></span></a>
        <a href="#checkout-fields" className="group rounded-md border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="font-semibold"><LocalizedText value={"Checkout fields"} /></span><span className="mt-1 block text-sm text-muted-foreground"><LocalizedText value={"Choose cashier controls and add or remove information captured on bills."} /></span><span className="mt-3 block text-sm font-medium text-primary"><LocalizedText value={"Configure checkout fields ↓"} /></span></a>
      </nav>
      <Card id="billing-behavior" className="scroll-mt-24"><CardContent className="grid gap-4">
        <div><h2 className="font-semibold"><LocalizedText value={"Billing behavior"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={"Each store keeps its own complete configuration. Amounts use the organization currency, "} />{data.currency ?? "OMR"}.</p></div>
        <BillingForm storeId={storeId} own={(data.billing ?? {}) as never} canEdit={canEdit} store={{ name: store?.name ?? "Store" }} />
      </CardContent></Card>
      <Card id="checkout-fields" className="scroll-mt-24"><CardContent className="grid gap-4"><StoreCheckoutFieldEditor storeId={storeId} initial={(data.checkoutFieldSettings ?? {}) as never} canEdit={canEdit} /></CardContent></Card>
    </div>
  </>;
}

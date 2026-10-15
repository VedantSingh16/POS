import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Money } from "@/components/data/primitives";
import { RelativeTime } from "@/components/data/relative-time";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/features/api";
import { CreditSheet } from "@/features/actions";

export default async function CustomerDetail({ params }: PageProps<"/org/customers/[id]">) {
  await requirePermission("customer.view");
  const { id } = await params;
  const [{ data: c }, { data: stores }] = await Promise.all([api.customer(id), api.stores()]);
  if (!c) notFound();
  return (
    <>
      <PageHeader title={c.name} description={c.phone} crumbs={[{ label: "Customers", href: "/org/customers" }, { label: c.name }]} backHref="/org/customers" backLabel="Back to customers" actions={<CreditSheet customerId={c.id} stores={stores.map((s) => ({ id: s.id, name: s.name }))} />} />
      <Card><CardContent className="grid gap-4 sm:grid-cols-3">
        <div><p className="text-xs text-muted-foreground"><LocalizedText value={"Tier"} /></p><p className="font-medium">{c.tier}</p></div>
        <div><p className="text-xs text-muted-foreground"><LocalizedText value={"Wallet"} /></p><Money minor={c.walletMinor} /></div>
        <div><p className="text-xs text-muted-foreground"><LocalizedText value={"Lifetime spend"} /></p><Money minor={c.lifetimeMinor} /></div>
      </CardContent></Card>
      <Card className="mt-4"><CardContent><h2 className="mb-3 font-semibold"><LocalizedText value={"Purchase history"} /></h2>{c.sales?.length ? <div className="divide-y">{c.sales.map((sale: { id: string; receiptNumber: string; totalCents: number; createdAt: string; returns?: { id: string; creditNoteNumber: string; totalCents: number }[] }) => <div key={sale.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{sale.receiptNumber}</p><p className="text-muted-foreground"><RelativeTime value={sale.createdAt} /></p></div><div className="text-end"><Money minor={sale.totalCents} />{sale.returns?.length ? <p className="text-xs text-warning">{sale.returns.length} <LocalizedText value={"return(s)"} /></p> : null}</div></div>)}</div> : <p className="text-sm text-muted-foreground"><LocalizedText value={"No completed purchases yet."} /></p>}</CardContent></Card>
    </>
  );
}

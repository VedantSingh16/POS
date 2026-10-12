import { requirePermission } from "@/lib/server/session";
/* The detail endpoint contains module-specific line/payment JSON that is rendered as received. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Money, StatusBadge } from "@/components/data/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/features/api";
import { PrintActions } from "@/features/sales/print-actions";

export default async function SaleDetail({ params }: PageProps<"/s/[storeId]/sales/[id]">) {
  const { storeId, id } = await params;
  await requirePermission("sale.create", storeId);
  const { data: s } = await api.sale(id, storeId);
  if (!s) notFound();
  return (
    <>
      <PageHeader title={s.receipt} crumbs={[{ label: "Sales", href: `/s/${storeId}/sales` }, { label: s.receipt }]} actions={<PrintActions storeId={storeId} saleId={id} receipt={s.receipt} />} />
      <div className="print-receipt"><Card><CardContent className="grid gap-4 sm:grid-cols-4">
        <div><p className="text-xs text-muted-foreground">Total</p><Money minor={s.totalMinor} /></div>
        <div><p className="text-xs text-muted-foreground">Tender</p><p>{s.tender}</p></div>
        <div><p className="text-xs text-muted-foreground">Cashier</p><p>{s.cashier}</p></div>
        <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={s.status} /></div>
      </CardContent></Card>
      <Card className="mt-4"><CardContent><h2 className="mb-3 font-semibold">Lines</h2><div className="divide-y">{(s.lines ?? []).map((line: any) => <div key={line.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1">{line.name}<span className="ml-2 text-xs text-muted-foreground">{line.sku} × {line.quantity}</span></span><Money minor={line.lineTotalCents} /></div>)}</div>{(s.charges ?? []).map((charge: any) => <div key={charge.id ?? charge.name} className="mt-2 flex justify-between text-sm"><span>{charge.name}</span><Money minor={charge.amountCents} /></div>)}<div className="mt-3 flex justify-between border-t pt-3 text-sm"><span>Tax</span><Money minor={s.taxCents ?? 0} /></div></CardContent></Card>
      <Card className="mt-4"><CardContent><h2 className="mb-3 font-semibold">Payments and returns</h2><div className="grid gap-2 text-sm">{(s.payments ?? []).map((payment: any) => <div key={payment.id ?? `${payment.tenderType}-${payment.amountCents}`} className="flex justify-between"><span>{payment.tenderType}{payment.reference ? ` · ${payment.reference}` : ""}</span><Money minor={payment.amountCents} /></div>)}{(s.returns ?? []).map((item: any) => <div key={item.id} className="flex justify-between text-muted-foreground"><span>Credit note {item.creditNoteNumber}</span><Money minor={-item.totalCents} /></div>)}</div></CardContent></Card>{s.receiptFooter && <p className="mt-4 text-center text-sm text-muted-foreground">{s.receiptFooter}</p>}</div>
    </>
  );
}

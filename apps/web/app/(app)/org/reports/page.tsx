import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { HourChart, TenderChart, TrendChart } from "@/components/data/charts";
import { api } from "@/features/api";
import { requireSession } from "@/lib/server/session";
import { KpiTile, Money } from "@/components/data/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  await requirePermission("report.view");
  const me = await requireSession();
  const [{ data }, { data: report }, { data: stores }] = await Promise.all([api.charts(), api.reports(), api.stores()]);
  // One real report per store, so organisation totals and individual stores are never confused.
  const perStore = await Promise.all(stores.filter((store) => store.status === "ACTIVE").map(async (store) => {
    try { return { store, report: (await api.reports(store.id)).data }; } catch { return { store, report: null }; }
  }));
  const canExport = me.permissions.organization.includes("report.export");
  return (
    <>
      <PageHeader title="Reports & analytics" description="Organisation-wide figures across every store, followed by a store-by-store comparison." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Reports & analytics" }]} actions={canExport ? <Link className={buttonVariants({ variant: "outline" })} href="/api/proxy/pos/v1/reports/export">Export CSV</Link> : null} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><KpiTile label="All stores · sales" value={<Money minor={report.sales.totalCents} />} hint={`${report.sales.count} transactions`} /><KpiTile label="All stores · average order" value={<Money minor={report.kpis.averageOrderValueCents} />} /><KpiTile label="All stores · gross margin" value={<Money minor={report.kpis.grossMarginCents} />} hint="From sale-time cost snapshots" tone="success" /><KpiTile label="All stores · returns" value={<Money minor={report.returns.totalCents} />} hint={`${report.returns.count} returns`} tone="warning" /></div>
      <Card className="mb-4"><CardHeader><CardTitle>Store comparison</CardTitle></CardHeader><CardContent>
        {perStore.length === 0 ? <p className="text-sm text-muted-foreground">No active stores to compare yet.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">Store</th><th className="py-2 text-right">Sales</th><th className="py-2 text-right">Transactions</th><th className="py-2 text-right">Average order</th><th className="py-2 text-right">Returns</th><th className="py-2" /></tr></thead><tbody>
          {perStore.map(({ store, report: r }) => <tr key={store.id} className="border-b"><td className="py-2 font-medium">{store.name}<span className="ml-2 font-mono text-xs text-muted-foreground">{store.code}</span></td>{r ? <><td className="py-2 text-right"><Money minor={r.sales.totalCents} /></td><td className="py-2 text-right tabular">{r.sales.count}</td><td className="py-2 text-right"><Money minor={r.kpis.averageOrderValueCents} /></td><td className="py-2 text-right"><Money minor={r.returns.totalCents} /></td></> : <td colSpan={4} className="py-2 text-right text-muted-foreground">Report unavailable</td>}<td className="py-2 text-right"><Link href={`/s/${store.id}/reports`} className="text-xs text-primary hover:underline">Store report</Link></td></tr>)}
        </tbody></table></div>}
      </CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2"><TrendChart data={data.trend} /><HourChart data={data.byHour} /><TenderChart data={data.tender} /></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>GST summary</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">HSN</th><th className="py-2">Rate</th><th className="py-2 text-right">Taxable</th><th className="py-2 text-right">GST</th></tr></thead><tbody>{report.gst.map((row: { hsnCode: string; rateBps: number; taxableCents: number; taxCents: number }) => <tr key={`${row.hsnCode}-${row.rateBps}`} className="border-b"><td className="py-2">{row.hsnCode || "—"}</td><td className="py-2">{row.rateBps / 100}%</td><td className="py-2 text-right"><Money minor={row.taxableCents} /></td><td className="py-2 text-right"><Money minor={row.taxCents} /></td></tr>)}</tbody></table></div></CardContent></Card><Card><CardHeader><CardTitle>Cash reconciliation</CardTitle></CardHeader><CardContent>{report.cashReconciliation.length ? <div className="divide-y">{report.cashReconciliation.slice(0, 8).map((row: { sessionId: string; register: string; cashier: string; status: string; varianceCents: number | null }) => <div key={row.sessionId} className="flex justify-between gap-3 py-2 text-sm"><span>{row.register} · {row.cashier}<span className="block text-xs text-muted-foreground">{row.status}</span></span><Money minor={row.varianceCents ?? 0} /></div>)}</div> : <p className="text-sm text-muted-foreground">No register sessions in this period.</p>}</CardContent></Card></div>
    </>
  );
}

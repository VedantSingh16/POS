import { requirePermission } from "@/lib/server/session";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/app/page-header";
import { HourChart, TenderChart, TrendChart } from "@/components/data/charts";
import { Money } from "@/components/data/primitives";
import { api } from "@/features/api";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Store reports" };

export default async function StoreReports({ params }: PageProps<"/s/[storeId]/reports">) {
  const { storeId } = await params;
  const me = await requirePermission("report.view", storeId);
  const canExport = hasPermission(me, "report.export", storeId);
  const [{ data }, { data: report }] = await Promise.all([api.charts(storeId), api.reports(storeId)]);
  return (
    <>
      <PageHeader title="Store reports" description="Sales performance for this store." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Reports" }]} actions={canExport ? <Link className={buttonVariants({ variant: "outline" })} href={`/api/proxy/pos/v1/reports/export?storeId=${encodeURIComponent(storeId)}`}>Export CSV</Link> : undefined} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Sales</p><Money minor={report.sales.totalCents} /><p className="text-xs text-muted-foreground">{report.sales.count} transactions</p></div><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Average order</p><Money minor={report.kpis.averageOrderValueCents} /></div><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Gross margin</p><Money minor={report.kpis.grossMarginCents} /></div><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground">Returns</p><Money minor={report.returns.totalCents} /></div></div>
      <div className="grid gap-4 lg:grid-cols-2"><TrendChart data={data.trend} /><HourChart data={data.byHour} /><TenderChart data={data.tender} /></div>
    </>
  );
}

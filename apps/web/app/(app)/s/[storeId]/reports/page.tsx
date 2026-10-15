import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import { hasPermission } from "@/lib/permissions";
import { PageHeader } from "@/components/app/page-header";
import { HourChart, TenderChart, TrendChart } from "@/components/data/charts";
import { Money } from "@/components/data/primitives";
import { api } from "@/features/api";
import { NativeSelect, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ReportOperations } from "@/features/reports/report-operations";
import { getServerLocale } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/format";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Store reports") }; }

export default async function StoreReports({ params, searchParams }: PageProps<"/s/[storeId]/reports">) {
  const locale = await getServerLocale();
  const { storeId } = await params;
  const me = await requirePermission("report.view", storeId);
  const canExport = hasPermission(me, "report.export", storeId);
  const canDayClose = hasPermission(me, "dayclose.manage", storeId);
  const query = await searchParams;
  const filters = {
    ...(typeof query.from === "string" ? { from: query.from } : {}),
    ...(typeof query.to === "string" ? { to: query.to } : {}),
    ...(typeof query.registerId === "string" ? { registerId: query.registerId } : {}),
    ...(typeof query.cashierId === "string" ? { cashierId: query.cashierId } : {}),
  };
  const [{ data }, { data: report }, { data: dayCloses }, registersResult, staffResult] = await Promise.all([
    api.charts(storeId, filters), api.reports(storeId, filters), api.dayCloses(storeId),
    api.registers(storeId).catch(() => ({ data: [] as { id: string; name: string; code?: string }[] })),
    hasPermission(me, "store.staff.view", storeId) ? api.storeStaff(storeId).catch(() => ({ data: [] as { id: string; name: string }[] })) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  return (
    <>
      <PageHeader title="Store reports" description="Filter store performance and create auditable report exports." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Reports" }]} />
      <form className="mb-5 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end" action={`/s/${storeId}/reports`} method="get">
        <label className="grid gap-1 text-sm"><LocalizedText value={"From"} /><Input name="from" type="date" defaultValue={filters.from ?? ""} /></label>
        <label className="grid gap-1 text-sm"><LocalizedText value={"To"} /><Input name="to" type="date" defaultValue={filters.to ?? ""} /></label>
        <label className="grid gap-1 text-sm"><LocalizedText value={"Register"} /><NativeSelect name="registerId" defaultValue={filters.registerId ?? ""}><option value=""><LocalizedText value={"All registers"} /></option>{registersResult.data.map((register) => <option key={register.id} value={register.id}>{register.name} {register.code ? `(${register.code})` : ""}</option>)}</NativeSelect></label>
        <label className="grid gap-1 text-sm"><LocalizedText value={"Cashier / bill handler"} /><NativeSelect name="cashierId" defaultValue={filters.cashierId ?? ""}><option value=""><LocalizedText value={"All staff"} /></option>{staffResult.data.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</NativeSelect></label>
        <Button><LocalizedText value={"Apply filters"} /></Button>
      </form>
      <p className="mb-3 text-xs text-muted-foreground"><LocalizedText value={"Period shown in "} />{report.timezone}: {formatDateTime(report.period.from, locale, report.timezone)} – {formatDateTime(report.period.to, locale, report.timezone)} <LocalizedText value={"· Data as of "} />{formatDateTime(report.asOf, locale, report.timezone)}.</p>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground"><LocalizedText value={"Sales"} /></p><Money minor={report.sales.totalCents} /><p className="text-xs text-muted-foreground">{report.sales.count} <LocalizedText value={"transactions"} /></p></div><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground"><LocalizedText value={"Average order"} /></p><Money minor={report.kpis.averageOrderValueCents} /></div><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground"><LocalizedText value={"Gross margin"} /></p><Money minor={report.kpis.grossMarginCents} /></div><div className="rounded-lg border bg-card p-4"><p className="text-sm text-muted-foreground"><LocalizedText value={"Returns"} /></p><Money minor={report.returns.totalCents} /></div></div>
      <div className="grid gap-4 lg:grid-cols-2"><TrendChart data={data.trend} /><HourChart data={data.byHour} /><TenderChart data={data.tender} /></div>
      <div className="mt-5"><ReportOperations storeId={storeId} canExport={canExport} canDayClose={canDayClose} dayCloses={dayCloses} /></div>
    </>
  );
}

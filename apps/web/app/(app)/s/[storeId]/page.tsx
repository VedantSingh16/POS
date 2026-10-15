import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import Link from "next/link";
import { Banknote, Clock3, Receipt, ShoppingCart, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { HourChart, TenderChart } from "@/components/data/charts";
import { KpiTile } from "@/components/data/primitives";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/data/primitives";
import { api } from "@/features/api";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/server/session";
import { getServerLocale } from "@/lib/i18n/server";
import { formatTime } from "@/lib/format";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Store dashboard") }; }

export default async function StoreDashboard({ params }: PageProps<"/s/[storeId]">) {
  const { storeId } = await params;
  const me = await requirePermission("store.overview.view", storeId);
  const store = me.stores.find((s) => s.id === storeId);
  const canReport = hasPermission(me, "report.view", storeId);
  const canSell = hasPermission(me, "sale.create", storeId);
  const canViewSales = hasPermission(me, "sale.view", storeId);
  const canViewRegisters = hasPermission(me, "registers.view", storeId);
  const [{ data: charts }, { data: alerts }, { data: sales }, { data: registers }] = await Promise.all([
    canReport ? api.charts(storeId) : Promise.resolve({ data: { trend: [], byHour: [], tender: [] } }),
    canReport ? api.alerts(storeId) : Promise.resolve({ data: [] }),
    // This is a server component evaluated per request; the dashboard range must be anchored to the current day.
    // eslint-disable-next-line react-hooks/purity
    canViewSales ? api.sales(storeId, { from: new Date(Date.now() - 36 * 3600_000).toISOString().slice(0, 10), to: new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10) }) : Promise.resolve({ data: [] }),
    canViewRegisters ? api.registers(storeId) : Promise.resolve({ data: [] }),
  ]);
  // "Today" is the store's own calendar day, not the server's UTC day.
  const zone = await api.storeSettings(storeId).then((r) => String((r.data as { timezone?: string }).timezone || "Asia/Kolkata")).catch(() => "Asia/Kolkata");
  const locale = await getServerLocale();
  const dayKey = (value: Date) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(value); } catch { return value.toISOString().slice(0, 10); } };
  const todayKey = dayKey(new Date());
  const today = sales.filter((s) => s.status !== "VOIDED" && dayKey(new Date(s.at)) === todayKey);
  const gross = today.reduce((a, s) => a + s.totalMinor, 0);
  const activeAlerts = alerts.filter((alert) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED");
  const recent = [...sales].filter((sale) => sale.status !== "VOIDED").sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6);
  const cashInRegisters = canViewRegisters ? registers.filter((register) => register.status === "OPEN").reduce((sum, register) => sum + register.expectedMinor, 0) : null;
  const time = (value: string) => formatTime(value, locale, zone);
  return (
    <>
      <PageHeader title="Store overview" description={`Today at ${store?.name ?? "this store"}. Sales and operational status for this store.`} crumbs={[{ label: "Stores" }, { label: store?.name ?? "" }]}
        actions={canSell ? <Link href={`/s/${storeId}/pos`} className={buttonVariants()}><ShoppingCart /> <LocalizedText value={"Open POS"} /></Link> : undefined} />
      <div className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-card px-4 py-4 sm:grid-cols-4 sm:px-5">
        <KpiTile label="Sales today" value={canViewSales ? <Money minor={gross} /> : "—"} hint={canViewSales ? "Gross sales" : "No access"} icon={Receipt} />
        <KpiTile label="Transactions" value={canViewSales ? today.length : "—"} hint={canViewSales ? "Today" : "No access"} icon={ShoppingCart} />
        <KpiTile label="Average basket" value={canViewSales ? <Money minor={today.length ? Math.round(gross / today.length) : 0} /> : "—"} hint={canViewSales ? "Today" : "No access"} icon={ShoppingCart} />
        <KpiTile label="Cash in open registers" value={cashInRegisters === null ? "—" : <Money minor={cashInRegisters} />} hint={canViewRegisters ? `${registers.filter((register) => register.status === "OPEN").length} open` : "No access"} icon={Banknote} />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(19rem,1fr)]">
        <div className="grid gap-5">
          {canReport ? <HourChart data={charts.byHour} /> : <Card><CardHeader><CardTitle><LocalizedText value={"Sales by hour, today"} /></CardTitle></CardHeader><CardContent className="py-8 text-sm text-muted-foreground"><LocalizedText value={"Sales details are not available for this account."} /></CardContent></Card>}
          <Card>
            <CardHeader><CardTitle><LocalizedText value={"Recent transactions"} /></CardTitle><Link href={`/s/${storeId}/sales`} className="text-xs text-primary hover:underline"><LocalizedText value={"View sales"} /></Link></CardHeader>
            <CardContent className="p-0">
              {!canViewSales ? <div className="px-4 py-8 text-sm text-muted-foreground"><LocalizedText value={"Sales details are not available for this account."} /></div> : recent.length === 0 ? <div className="px-4 py-8 text-sm text-muted-foreground"><LocalizedText value={"No transactions recorded yet."} /></div> : <ul className="divide-y">
                {recent.map((sale) => <li key={sale.id}><Link href={`/s/${storeId}/sales/${sale.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/35 sm:grid-cols-[minmax(0,1.4fr)_minmax(6rem,.8fr)_minmax(4rem,.5fr)_auto]">
                  <span className="min-w-0"><span className="block truncate font-medium">{sale.receipt}</span><span className="block truncate text-xs text-muted-foreground">{sale.cashier} · {sale.register}</span></span><span className="tabular text-xs text-muted-foreground"><Clock3 className="me-1 inline size-3" />{time(sale.at)}</span><span className="text-xs text-muted-foreground">{sale.tender.replaceAll("_", " ")}</span><Money minor={sale.totalMinor} />
                </Link></li>)}
              </ul>}
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-5">
          {canReport ? <TenderChart data={charts.tender} /> : <Card><CardHeader><CardTitle><LocalizedText value={"Payment mix"} /></CardTitle></CardHeader><CardContent className="py-8 text-sm text-muted-foreground"><LocalizedText value={"Payment details are not available for this account."} /></CardContent></Card>}
          <Card>
            <CardHeader><CardTitle><LocalizedText value={"Needs attention "} /><span className="ms-1 tabular text-muted-foreground">{activeAlerts.length}</span></CardTitle><Link href={`/s/${storeId}/alerts`} className="text-xs text-primary hover:underline"><LocalizedText value={"All alerts"} /></Link></CardHeader>
            <CardContent className="p-0">
              {!canReport ? <p className="px-4 py-5 text-sm text-muted-foreground"><LocalizedText value={"Alerts are not available for this account."} /></p> : activeAlerts.length === 0 ? <p className="px-4 py-5 text-sm text-muted-foreground"><LocalizedText value={"No open alerts."} /></p> : <ul className="divide-y">{activeAlerts.slice(0, 6).map((alert) => <li key={alert.id} className="flex gap-2.5 px-4 py-3 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" /><div className="min-w-0"><p className="font-medium">{alert.title === "DISTRIBUTION_PENDING" ? "Products waiting for review" : alert.title.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</p><p className="mt-0.5 text-xs text-muted-foreground">{alert.detail}</p></div></li>)}</ul>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

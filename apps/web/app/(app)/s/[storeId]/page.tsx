import Link from "next/link";
import { Banknote, Receipt, ShoppingCart, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { HourChart, TenderChart } from "@/components/data/charts";
import { KpiTile } from "@/components/data/primitives";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/data/primitives";
import { api } from "@/features/api";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Store dashboard" };

export default async function StoreDashboard({ params }: PageProps<"/s/[storeId]">) {
  const { storeId } = await params;
  const me = await requirePermission("store.overview.view", storeId);
  const store = me.stores.find((s) => s.id === storeId);
  const canReport = hasPermission(me, "report.view", storeId);
  const canSell = hasPermission(me, "sale.create", storeId);
  const canViewRegisters = hasPermission(me, "registers.view", storeId);
  const [{ data: charts }, { data: alerts }, { data: sales }, { data: registers }] = await Promise.all([
    canReport ? api.charts(storeId) : Promise.resolve({ data: { trend: [], byHour: [], tender: [] } }),
    canReport ? api.alerts(storeId) : Promise.resolve({ data: [] }),
    canSell ? api.sales(storeId, { from: new Date(Date.now() - 36 * 3600_000).toISOString().slice(0, 10), to: new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10) }) : Promise.resolve({ data: [] }),
    canViewRegisters ? api.registers(storeId) : Promise.resolve({ data: [] }),
  ]);
  // "Today" is the store's own calendar day, not the server's UTC day.
  const zone = await api.storeSettings(storeId).then((r) => String((r.data as { timezone?: string }).timezone || "Asia/Kolkata")).catch(() => "Asia/Kolkata");
  const dayKey = (value: Date) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(value); } catch { return value.toISOString().slice(0, 10); } };
  const todayKey = dayKey(new Date());
  const today = sales.filter((s) => s.status !== "VOIDED" && dayKey(new Date(s.at)) === todayKey);
  const gross = today.reduce((a, s) => a + s.totalMinor, 0);
  return (
    <>
      <PageHeader title="Store overview" description={`Today at ${store?.name ?? "this store"}: sales, tills and alerts for this store only.`} crumbs={[{ label: "Stores" }, { label: store?.name ?? "" }]}
        actions={<Link href={`/s/${storeId}/pos`} className={buttonVariants()}><ShoppingCart /> Open POS</Link>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Sales today" value={<Money minor={gross} className="text-2xl font-semibold" />} hint={`${today.length} receipts`} icon={Receipt} />
        <KpiTile label="Average basket" value={<Money minor={today.length ? Math.round(gross / today.length) : 0} className="text-2xl font-semibold" />} icon={ShoppingCart} />
        <KpiTile label="Cash in open tills" value={<Money minor={registers.filter((register) => register.status === "OPEN").reduce((sum, register) => sum + register.expectedMinor, 0)} className="text-2xl font-semibold" />} hint={`${registers.filter((register) => register.status === "OPEN").length} registers open`} icon={Banknote} />
        <KpiTile label="Open alerts" value={alerts.length} hint="Stock and register" icon={TriangleAlert} tone="warning" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><HourChart data={charts.byHour} /></div>
        <TenderChart data={charts.tender} />
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Alerts</CardTitle><Link href={`/s/${storeId}/alerts`} className="text-xs text-primary hover:underline">View all</Link></CardHeader>
          <CardContent><ul className="grid gap-2">{alerts.map((a) => <li key={a.id} className="text-sm"><span className="font-medium">{a.title}</span> <span className="text-muted-foreground">· {a.detail}</span></li>)}</ul></CardContent>
        </Card>
      </div>
    </>
  );
}

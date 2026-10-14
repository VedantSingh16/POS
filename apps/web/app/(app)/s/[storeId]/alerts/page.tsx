import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { RelativeTime } from "@/components/data/relative-time";
import { api } from "@/features/api";
import { AckAlertButton } from "@/features/actions";
import { requireSession } from "@/lib/server/session";
import { hasPermission } from "@/lib/permissions";
import { redirect } from "next/navigation";

export const metadata = { title: "Alerts" };
const ICON = { warning: AlertTriangle, danger: OctagonAlert, info: Info, high: OctagonAlert, medium: AlertTriangle, low: Info } as const;
const COLOR = { warning: "text-warning", danger: "text-danger", info: "text-info", high: "text-danger", medium: "text-warning", low: "text-info" } as const;

export default async function Alerts({ params }: PageProps<"/s/[storeId]/alerts">) {
  const { storeId } = await params;
  const me = await requireSession();
  if (!hasPermission(me, "report.view", storeId) && !hasPermission(me, "store-catalog.verify", storeId)) redirect("/forbidden");
  const { data } = await api.alerts(storeId);
  return (
    <>
      <PageHeader title="Alerts" description="Pending product reviews, low stock, cash variance and registers left open." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Alerts" }]} />
      <Card><ul className="divide-y">{data.map((a) => { const severity = a.severity.toLowerCase() as keyof typeof ICON; const Icon = ICON[severity] ?? Info; const color = COLOR[severity] ?? "text-info"; return (
        <li key={a.id} className="flex items-start gap-3 p-4"><Icon className={`mt-0.5 size-4 ${color}`} /><div className="min-w-0 flex-1"><p className="font-medium">{a.title === "DISTRIBUTION_PENDING" ? "Products waiting for review" : a.title}</p><p className="text-sm text-muted-foreground">{a.detail}</p><p className="mt-1 text-xs text-muted-foreground">{a.status} · seen {a.occurrenceCount ?? 1} time{(a.occurrenceCount ?? 1) === 1 ? "" : "s"}{a.resolutionNote ? ` · ${a.resolutionNote}` : ""}</p>{a.title === "DISTRIBUTION_PENDING" && a.status !== "RESOLVED" && <Link className="mt-2 inline-block text-sm font-medium text-primary hover:underline" href={`/s/${storeId}/products`}>Review products</Link>}</div><span className="text-xs text-muted-foreground"><RelativeTime value={a.lastSeenAt ?? a.at} /></span><AckAlertButton id={a.id} storeId={storeId} status={a.status} /></li>); })}</ul></Card>
    </>
  );
}

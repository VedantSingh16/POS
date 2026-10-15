import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, KpiTile, Money, StatusBadge } from "@/components/data/primitives";
import { Receipt } from "lucide-react";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("UI kit") }; }

export default function UiKit() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-xl font-semibold"><LocalizedText value={"UI kit (development only)"} /></h1>
      <section aria-label="Buttons" className="flex flex-wrap gap-2">
        {(["default", "secondary", "outline", "ghost", "destructive", "success"] as const).map((v) => <Button key={v} variant={v}>{v}</Button>)}
        <Button disabled><LocalizedText value={"disabled"} /></Button><Button size="touch"><LocalizedText value={"touch"} /></Button>
      </section>
      <section aria-label="Inputs" className="grid max-w-sm gap-2"><Input placeholder="Default" /><Input placeholder="Invalid" aria-invalid /><Input placeholder="Disabled" disabled /></section>
      <section aria-label="Badges" className="flex flex-wrap gap-2">{(["neutral", "success", "warning", "danger", "info", "brand"] as const).map((t) => <Badge key={t} tone={t}>{t}</Badge>)}<StatusBadge status="PARTIALLY_RETURNED" /></section>
      <section aria-label="Money" className="flex gap-4"><Money minor={12345600} /><Money minor={-5000} /></section>
      <section aria-label="KPI" className="grid gap-3 sm:grid-cols-2"><KpiTile label="Sales today" value={<Money minor={4865000} />} icon={Receipt} hint="14 receipts" /><Skeleton className="h-24" /></section>
      <section aria-label="States" className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border"><EmptyState title="Empty" description="Nothing to show yet." /></div><div className="rounded-lg border"><ErrorState description="Could not load." /></div></section>
    </main>
  );
}

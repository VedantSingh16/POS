"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useLocale } from "@/components/i18n/locale-provider";

type DayClose = { id: string; businessDate: string; version: number; status: string; snapshot: Record<string, unknown>; closeReason: string; closedAt: string; closedBy: string; revisions: { version: number; reason: string; createdAt: string }[] };
type ExportJob = { id: string; status: "QUEUED" | "PROCESSING" | "READY" | "FAILED"; format: "CSV" | "PDF"; errorMessage?: string; attempts?: number; expiresAt?: string };

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export function ReportOperations({ storeId, canExport, canDayClose, dayCloses }: { storeId: string; canExport: boolean; canDayClose: boolean; dayCloses: DayClose[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [businessDate, setBusinessDate] = React.useState(today);
  const [closeReason, setCloseReason] = React.useState("");
  const [forceClose, setForceClose] = React.useState(false);
  const [format, setFormat] = React.useState<"CSV" | "PDF">("CSV");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [job, setJob] = React.useState<ExportJob | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!job || job.status === "READY" || job.status === "FAILED") return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const current = await clientApi<ExportJob>(`/pos/v1/reports/exports/${job.id}`);
        if (active) setJob(current);
      } catch (error) {
        if (active) { setJob({ ...job, status: "FAILED", errorMessage: error instanceof Error ? error.message : "Status check failed" }); }
      }
    }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [job]);

  async function closeDay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (forceClose && !closeReason.trim()) { toast.error("Enter a reason before force-closing open registers."); return; }
    setBusy(true);
    try {
      await clientApi("/pos/v1/day-closes", { method: "POST", headers: { "x-store-id": storeId }, body: JSON.stringify({ storeId, businessDate, forceClose, reason: closeReason.trim() || undefined }) });
      toast.success("Business day closed and totals saved."); setCloseReason(""); setForceClose(false); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not close the business day"); }
    finally { setBusy(false); }
  }

  async function createExport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await clientApi<ExportJob>("/pos/v1/reports/exports", { method: "POST", headers: { "x-store-id": storeId }, body: JSON.stringify({ storeId, format, from: from || undefined, to: to || undefined }) });
      setJob(created); toast.success("Report export queued.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not queue the report"); }
    finally { setBusy(false); }
  }

  async function download() {
    if (!job) return;
    const response = await fetch(`/api/proxy/pos/v1/reports/exports/${job.id}/download`);
    if (!response.ok) { const body = await response.json().catch(() => ({})) as { message?: string }; toast.error(body.message ?? "Export download failed"); return; }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pos-report-${job.id}.${job.format.toLowerCase()}`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function retry() {
    if (!job) return;
    setBusy(true);
    try { setJob(await clientApi<ExportJob>(`/pos/v1/reports/exports/${job.id}/retry`, { method: "POST", body: "{}" })); toast.success("Retry queued."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Retry failed"); }
    finally { setBusy(false); }
  }

  return <div className="grid gap-4">
    {canDayClose && <Card><CardHeader><CardTitle><LocalizedText value={"Store day close"} /></CardTitle></CardHeader><CardContent className="grid gap-4">
      <p className="text-sm text-muted-foreground"><LocalizedText value={"Save a time-zone-aware snapshot after registers close. If registers are still open, close them first or force-close with a reason."} /></p>
      <form className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end" onSubmit={closeDay}>
        <label className="grid gap-1 text-sm"><LocalizedText value={"Business date"} /><Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} required /></label>
        <label className="grid gap-1 text-sm"><LocalizedText value={"Close reason (required for force close or restatement)"} /><Input value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder="Optional for a normal close" /></label>
        <Button disabled={busy || !businessDate}><LocalizedText value={"Close business day"} /></Button>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={forceClose} onChange={(event) => setForceClose(event.target.checked)} /> <LocalizedText value={"Force-close open registers using their last ledger expected cash, with this reason recorded."} /></label>
      </form>
      {dayCloses.length > 0 && <div className="overflow-x-auto"><table className="w-full text-start text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="py-2"><LocalizedText value={"Date"} /></th><th className="py-2"><LocalizedText value={"Status"} /></th><th className="py-2"><LocalizedText value={"Sales"} /></th><th className="py-2"><LocalizedText value={"Returns"} /></th><th className="py-2"><LocalizedText value={"Version"} /></th><th className="py-2"><LocalizedText value={"Closed by"} /></th></tr></thead><tbody className="divide-y">{dayCloses.slice(0, 15).map((row) => <tr key={row.id}><td className="py-2">{formatDate(row.businessDate, locale, "UTC")}</td><td className="py-2"><LocalizedText value={row.status} /></td><td className="py-2">{formatMoney(Number(row.snapshot.salesTotalCents ?? 0), locale)}</td><td className="py-2">{formatMoney(Number(row.snapshot.returnsTotalCents ?? 0), locale)}</td><td className="py-2">v{formatNumber(row.version, locale)}{row.revisions.length ? <> · {formatNumber(row.revisions.length, locale)} <LocalizedText value={"prior"} /></> : null}</td><td className="py-2">{row.closedBy}</td></tr>)}</tbody></table></div>}
    </CardContent></Card>}
    {canExport && <Card><CardHeader><CardTitle><LocalizedText value={"Background report export"} /></CardTitle></CardHeader><CardContent className="grid gap-4">
      <form className="grid gap-3 sm:grid-cols-4 sm:items-end" onSubmit={createExport}>
        <label className="grid gap-1 text-sm"><LocalizedText value={"Format"} /><NativeSelect value={format} onChange={(event) => setFormat(event.target.value as "CSV" | "PDF")}><option value="CSV"><LocalizedText value={"CSV"} /></option><option value="PDF"><LocalizedText value={"PDF"} /></option></NativeSelect></label>
        <label className="grid gap-1 text-sm"><LocalizedText value={"From"} /><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="grid gap-1 text-sm"><LocalizedText value={"To"} /><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <Button disabled={busy}><LocalizedText value={"Create export"} /></Button>
      </form>
      {job && <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"><div className="min-w-48 flex-1"><p className="font-medium">{job.format} <LocalizedText value={"export · "} />{job.status.toLowerCase()}</p>{job.errorMessage && <p className="text-danger">{job.errorMessage}</p>}{job.expiresAt && <p className="text-xs text-muted-foreground"><LocalizedText value={"Available until "} />{formatDateTime(job.expiresAt, locale)}</p>}</div>{job.status === "READY" && <Button size="sm" onClick={() => void download()}><LocalizedText value={"Download"} /></Button>}{job.status === "FAILED" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void retry()}><LocalizedText value={"Retry"} /></Button>}</div>}
    </CardContent></Card>}
  </div>;
}

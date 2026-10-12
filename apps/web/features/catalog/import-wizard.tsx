"use client";
import { useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clientApi } from "@/features/client-api";

type Row = Record<string, string>;
type Preview = { rowCount: number; validRows: number; errors: { row: number; field: string; message: string }[] };

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const split = (line: string) => [...line.matchAll(/(?:^|,)\s*(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((match) => (match[1] ?? match[2] ?? "").replaceAll('""', '"').trim());
  const headers = split(lines[0]).map((header) => header.toLowerCase());
  return lines.slice(1).map((line) => Object.fromEntries(split(line).map((value, index) => [headers[index] ?? `column_${index + 1}`, value])));
}

export function ImportWizard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  async function choose(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { toast.error("Choose a CSV file"); return; }
    const parsed = parseCsv(await file.text());
    if (!parsed.length) { toast.error("The CSV has no data rows"); return; }
    setRows(parsed); setBusy(true);
    try { setPreview(await clientApi<Preview>("/admin/catalog/import/preview", { method: "POST", body: JSON.stringify({ rows: parsed }) })); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not validate CSV"); }
    finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true);
    try { await clientApi("/admin/catalog/import/commit", { method: "POST", body: JSON.stringify({ rows }) }); toast.success(`${rows.length} products imported`); setRows([]); setPreview(null); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not import CSV"); }
    finally { setBusy(false); }
  }
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="size-5" /> CSV import</CardTitle></CardHeader><CardContent className="grid gap-4"><p className="text-sm text-muted-foreground">Required columns: <code>sku,name,price</code>. Optional: <code>productName,category,brand,ratePercent,barcode,includesTax</code>. Price is in rupees unless <code>priceCents</code> is supplied.</p><label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-8 text-sm hover:bg-accent"><Upload className="size-4" /> Choose CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void choose(event.target.files?.[0])} /></label>{busy && <p className="text-sm text-muted-foreground">Validating…</p>}{preview && <div className="grid gap-3"><div className="flex flex-wrap gap-4 text-sm"><span>{preview.rowCount} rows</span><span className="text-success">{preview.validRows} valid</span><span className={preview.errors.length ? "text-danger" : "text-success"}>{preview.errors.length} errors</span></div>{preview.errors.length > 0 && <ul className="max-h-48 overflow-y-auto rounded-md border p-3 text-sm text-danger">{preview.errors.map((error, index) => <li key={`${error.row}-${error.field}-${index}`}>Row {error.row || "existing"} · {error.field}: {error.message}</li>)}</ul>}{preview.errors.length === 0 && <Button onClick={() => void commit()} disabled={busy}>Commit {rows.length} rows</Button>}</div>}</CardContent></Card>;
}

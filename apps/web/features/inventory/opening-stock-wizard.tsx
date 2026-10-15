"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { clientApi } from "@/features/client-api";

type Row = { sku: string; quantity: number; status?: string; unitCostCents?: number };

function parseCsv(value: string): Row[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (line: string) => [...line.matchAll(/(?:^|,)\s*(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((match) => (match[1] ?? match[2] ?? "").replaceAll('""', '"').trim());
  const headers = split(lines[0]!).map((header) => header.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    return { sku: row.sku ?? "", quantity: Number(row.quantity), ...(row.status ? { status: row.status.toUpperCase() } : {}), ...(row.unitcostcents ? { unitCostCents: Number(row.unitcostcents) } : {}) };
  });
}

export function OpeningStockWizard({ storeId }: { storeId: string }) {
  const [csv, setCsv] = React.useState("sku,quantity,status\n");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [errors, setErrors] = React.useState<{ row: number; field: string; message: string }[]>([]);
  const [busy, setBusy] = React.useState(false);

  async function preview() {
    const parsed = parseCsv(csv);
    setRows(parsed); setErrors([]); setBusy(true);
    try {
      const result = await clientApi<{ errors?: typeof errors }>("/pos/v1/inventory/opening-stock/preview", { method: "POST", body: JSON.stringify({ storeId, rows: parsed }) });
      setErrors(result.errors ?? []);
      if (!result.errors?.length) toast.success(`${parsed.length} opening-stock rows validated`);
    } catch (error) { setErrors([{ row: 0, field: "file", message: error instanceof Error ? error.message : "Could not validate" }]); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true);
    try { await clientApi("/pos/v1/inventory/opening-stock/commit", { method: "POST", body: JSON.stringify({ storeId, rows }) }); toast.success("Opening stock imported"); }
    catch (error) { setErrors([{ row: 0, field: "import", message: error instanceof Error ? error.message : "Could not import" }]); }
    finally { setBusy(false); }
  }

  return <Card className="max-w-3xl"><CardContent className="grid gap-4 p-5">
    <div><h2 className="font-semibold"><LocalizedText value={"Opening stock CSV"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={"Columns: sku, quantity, optional status (SELLABLE or DAMAGED), and unitCostCents."} /></p></div>
    <Textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={10} aria-label="Opening stock CSV" className="font-mono text-xs" />
    <div className="flex gap-2"><Button onClick={() => void preview()} disabled={busy}><LocalizedText value={"Validate CSV"} /></Button><Button variant="outline" onClick={() => void commit()} disabled={busy || !rows.length || !!errors.length}><LocalizedText value={"Commit "} />{rows.length ? `${rows.length} rows` : "import"}</Button></div>
    {!!errors.length && <div role="alert" className="grid gap-1 rounded-md bg-danger-soft p-3 text-sm text-danger">{errors.map((error, index) => <p key={`${error.row}-${error.field}-${index}`}><LocalizedText value={"Row "} />{error.row || "—"}, {error.field}: {error.message}</p>)}</div>}
    {!!rows.length && !errors.length && <p className="text-sm text-success">{rows.length} <LocalizedText value={"rows are ready to commit."} /></p>}
  </CardContent></Card>;
}

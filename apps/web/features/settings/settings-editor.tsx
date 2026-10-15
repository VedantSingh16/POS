"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import { CURRENCIES } from "@pos/shared/currency";

type Field = { key: string; label: string; hint: string; kind: "select" | "text" | "number" };
const SECTIONS: Record<string, Field[]> = {
  general: [{ key: "inventoryPolicy", label: "Negative stock policy", hint: "What happens when a sale would take stock below zero.", kind: "select" }],
  receipts: [{ key: "receiptFooter", label: "Receipt footer", hint: "Printed at the bottom of every receipt (up to 300 characters).", kind: "text" }],
  security: [{ key: "idleLockMinutes", label: "Idle lock (minutes)", hint: "A till with a PIN locks after this many idle minutes. 1 to 240.", kind: "number" }],
};

export function SettingsEditor({ section, initial }: { section: string; initial: Record<string, unknown> }) {
  const router = useRouter();
  const fields = SECTIONS[section] ?? [];
  const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] === undefined || initial[f.key] === null ? (f.key === "idleLockMinutes" ? "15" : f.key === "inventoryPolicy" ? "BLOCK" : "") : String(typeof initial[f.key] === "object" ? "" : initial[f.key])])));
  const [busy, setBusy] = React.useState(false);
  async function save() {
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.kind === "number") {
        const n = Number(values[f.key]);
        if (!Number.isInteger(n) || n < 1 || n > 240) { toast.error(`${f.label} must be a whole number from 1 to 240.`); return; }
        body[f.key] = n;
      } else body[f.key] = values[f.key];
    }
    setBusy(true);
    try { await clientApi("/admin/settings", { method: "PATCH", body: JSON.stringify(body) }); toast.success("Settings saved"); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not save settings"); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:max-w-xl">
        {fields.map((f) => (
          <label key={f.key} className="grid gap-1.5 text-sm">
            <span className="font-medium"><LocalizedText value={f.label} /></span>
            {f.kind === "select"
              ? <NativeSelect value={values[f.key]} onChange={(e) => setValues((c) => ({ ...c, [f.key]: e.target.value }))}><option value="BLOCK"><LocalizedText value={"Block the sale"} /></option><option value="WARN"><LocalizedText value={"Warn but allow"} /></option><option value="ALLOW"><LocalizedText value={"Allow silently"} /></option></NativeSelect>
              : <Input type={f.kind === "number" ? "number" : "text"} maxLength={f.kind === "text" ? 300 : undefined} value={values[f.key]} onChange={(e) => setValues((c) => ({ ...c, [f.key]: e.target.value }))} />}
            <span className="text-xs text-muted-foreground"><LocalizedText value={f.hint} /></span>
          </label>
        ))}
      </div>
      <Button className="sm:w-fit" onClick={() => void save()} disabled={busy}><LocalizedText value={busy ? "Saving…" : "Save settings"} /></Button>
    </div>
  );
}

export function ApprovalPolicyForm({ initial }: { initial: { enabled: boolean; thresholdPercent: number } }) {
  const router = useRouter();
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [percent, setPercent] = React.useState(String(initial.thresholdPercent));
  const [busy, setBusy] = React.useState(false);
  async function save() {
    const n = Number(percent);
    if (!Number.isFinite(n) || n < 0 || n > 100) { toast.error("Enter a percentage from 0 to 100."); return; }
    setBusy(true);
    try { await clientApi("/admin/approval-policy", { method: "PUT", body: JSON.stringify({ enabled, thresholdPercent: n }) }); toast.success("Approval rule saved"); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the rule"); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-4 sm:max-w-xl">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> <LocalizedText value={"Require manager approval for large sale discounts"} /></label>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium"><LocalizedText value={"Approval needed above (% of the sale subtotal)"} /></span>
        <Input type="number" min={0} max={100} step="0.5" value={percent} onChange={(e) => setPercent(e.target.value)} disabled={!enabled} />
        <span className="text-xs text-muted-foreground"><LocalizedText value={"Discounts at or below this share go through; larger ones need a manager PIN or an approved request. When the rule is off, any permitted discount goes through."} /></span>
      </label>
      <Button className="sm:w-fit" onClick={() => void save()} disabled={busy}><LocalizedText value={busy ? "Saving…" : "Save rule"} /></Button>
    </div>
  );
}

/** Organisation currency. It applies to every store and locks once the first sale exists. */
export function CurrencyForm({ initial, locked = false }: { initial: string; locked?: boolean }) {
  const router = useRouter();
  const [code, setCode] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  async function save() {
    setBusy(true);
    try { await clientApi("/admin/settings", { method: "PATCH", body: JSON.stringify({ currency: code }) }); toast.success("Currency saved"); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the currency"); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-3 sm:max-w-xl">
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium"><LocalizedText value={"Currency"} /></span>
        <NativeSelect value={code} disabled={locked || busy} onChange={(e) => setCode(e.target.value)}>{Object.values(CURRENCIES).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}<LocalizedText value={c.code === "OMR" ? " (default)" : ""} /></option>)}</NativeSelect>
        <span className="text-xs text-muted-foreground">{locked ? `Locked at ${initial} because this organisation has completed a sale. Past amounts are kept in their original currency.` : "Applies to every store, price, bill, receipt, and invoice. Choose it before the first sale; stores inherit this value."}</span>
      </label>
      {!locked && <Button className="sm:w-fit" onClick={() => void save()} disabled={busy || code === initial}><LocalizedText value={busy ? "Saving…" : "Save currency"} /></Button>}
    </div>
  );
}

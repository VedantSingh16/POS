"use client";
import { LocalizedText } from "@/components/i18n/localized-text";

/* Additional charges and store-owned tax group controls. The API checks store access on every call. */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormSheet } from "@/components/form/dialogs";
import { L, SheetFooter, rupeesToPaise, send, useRun } from "@/features/actions";
import type { ChargeRow } from "@/features/types";
import { currencyCode, formatMoney, formatNumber, toInput } from "@/lib/format";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@pos/shared/locale";

type TaxOption = { id: string; name: string; ratePercent: number };

const describeValue = (charge: ChargeRow, locale: Locale) => charge.kind === "FLAT" ? formatMoney(charge.amountCents ?? 0, locale) : `${formatNumber(charge.ratePercent ?? 0, locale)}%`;
const describeApplies = (charge: ChargeRow) => charge.applies === "PER_ITEM" ? (charge.kind === "FLAT" ? "per item" : "on each item") : "per bill";

export function ChargeForm({ storeId, taxGroups, charge, onDone, taxLabel = "GST" }: { storeId?: string; taxGroups: TaxOption[]; charge?: ChargeRow; onDone: () => void; taxLabel?: string }) {
  const { busy, run } = useRun();
  const [v, setV] = React.useState({
    name: charge?.name ?? "",
    kind: charge?.kind ?? "FLAT",
    value: charge ? (charge.kind === "FLAT" ? toInput(charge.amountCents ?? 0) : String(charge.ratePercent ?? 0)) : "",
    applies: charge?.applies ?? "PER_BILL",
    taxGroupId: charge?.taxGroupId ?? "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((c) => ({ ...c, [k]: e.target.value }));
  return <form className="grid gap-4 pb-6" onSubmit={async (e) => {
    e.preventDefault();
    const amount = Number(v.value);
    if (v.name.trim().length < 2) { toast.error("Enter a name for the charge."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error("Enter an amount greater than zero."); return; }
    if (v.kind === "PERCENT" && amount > 100) { toast.error("A percentage cannot be above 100."); return; }
    const body = { ...(storeId ? { storeId } : {}), name: v.name.trim(), kind: v.kind, applies: v.applies, taxGroupId: v.taxGroupId || null, ...(v.kind === "FLAT" ? { amountCents: rupeesToPaise(v.value) } : { ratePercent: amount }) };
    const ok = charge
      ? await run(() => send(`/pos/v1/charges/${charge.id}`, "PATCH", body, storeId), "Charge updated")
      : await run(() => send("/pos/v1/charges", "POST", body, storeId), "Charge added");
    if (ok) onDone();
  }}>
    <L label="Name" hint="Shown on the bill and the invoice, e.g. Packaging or Service charge."><Input value={v.name} onChange={set("name")} /></L>
    <div className="grid gap-4 sm:grid-cols-2">
      <L label="Type"><NativeSelect value={v.kind} onChange={set("kind")}><option value="FLAT"><LocalizedText value={"Fixed amount ("} />{currencyCode()})</option><option value="PERCENT"><LocalizedText value={"Percentage of the bill (%)"} /></option></NativeSelect></L>
      <L label={v.kind === "FLAT" ? `Amount (${currencyCode()})` : "Percentage (%)"}><Input value={v.value} onChange={set("value")} inputMode="decimal" /></L>
    </div>
    <L label="Applies" hint={v.kind === "FLAT" ? "Per bill is charged once; per item is charged for every unit sold." : `Percentages are taken on the bill value before ${taxLabel}.`}><NativeSelect value={v.applies} onChange={set("applies")}><option value="PER_BILL"><LocalizedText value={"Once per bill"} /></option><option value="PER_ITEM"><LocalizedText value={"For every item"} /></option></NativeSelect></L>
    <L label={`${taxLabel} on this charge`} hint="Optional."><NativeSelect value={v.taxGroupId} onChange={set("taxGroupId")}><option value=""><LocalizedText value={`No ${taxLabel}`} /></option>{taxGroups.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.ratePercent}%</option>)}</NativeSelect></L>
    <SheetFooter busy={busy} label={charge ? "Save charge" : "Add charge"} />
  </form>;
}

export function NewChargeSheet({ storeId, taxGroups, taxLabel = "GST" }: { storeId?: string; taxGroups: TaxOption[]; taxLabel?: string }) {
  const [open, setOpen] = React.useState(false);
  return <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> <LocalizedText value={"Add charge"} /></Button>} title={storeId ? "Add a charge for this store" : "Add an organisation-wide charge"} description={storeId ? "Applies to bills in this store only, on top of any organisation-wide charges." : "Applies to bills in every store."}>
    <ChargeForm storeId={storeId} taxGroups={taxGroups} taxLabel={taxLabel} onDone={() => setOpen(false)} />
  </FormSheet>;
}

/** Table of charges. `editableScope` is the scope this screen may edit; the other scope is shown read-only. */
export function ChargesList({ charges, storeId, taxGroups, canEdit, taxLabel = "GST" }: { charges: ChargeRow[]; storeId?: string; taxGroups: TaxOption[]; canEdit: boolean; taxLabel?: string }) {
  const { locale } = useLocale();
  const { busy, run } = useRun();
  const [editing, setEditing] = React.useState<string | null>(null);
  if (charges.length === 0) return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground"><LocalizedText value={"No additional charges yet."} /></p>;
  return <div className="divide-y rounded-md border bg-card">
    {charges.map((charge) => {
      const mine = canEdit && (storeId ? charge.storeId === storeId : charge.storeId === null);
      return <div key={charge.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{charge.name} <Badge tone={charge.scope === "ORGANISATION" ? "brand" : "neutral"}><LocalizedText value={charge.scope === "ORGANISATION" ? "Organisation" : "This store"} /></Badge> {charge.status === "DISABLED" && <Badge tone="warning"><LocalizedText value={"Off"} /></Badge>}</p>
          <p className="text-xs text-muted-foreground">{describeValue(charge, locale)} <LocalizedText value={describeApplies(charge)} />{charge.taxGroupName ? <> · {taxLabel} {formatNumber(charge.taxRatePercent, locale)}% ({charge.taxGroupName})</> : <> · <LocalizedText value={`no ${taxLabel}`} /></>}</p>
        </div>
        {mine && <div className="flex gap-1.5">
          <FormSheet open={editing === charge.id} onOpenChange={(o) => setEditing(o ? charge.id : null)} trigger={<Button size="sm" variant="outline"><LocalizedText value={"Edit"} /></Button>} title={`Edit ${charge.name}`}>
            <ChargeForm storeId={storeId} taxGroups={taxGroups} charge={charge} taxLabel={taxLabel} onDone={() => setEditing(null)} />
          </FormSheet>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => send(`/pos/v1/charges/${charge.id}`, "PATCH", { ...(storeId ? { storeId } : {}), status: charge.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }, storeId), charge.status === "ACTIVE" ? "Charge turned off" : "Charge turned on")}><LocalizedText value={charge.status === "ACTIVE" ? "Turn off" : "Turn on"} /></Button>
        </div>}
      </div>;
    })}
  </div>;
}

export function NewStoreTaxGroupSheet({ storeId, taxLabel = "GST", codeLabel = "HSN / SAC" }: { storeId: string; taxLabel?: string; codeLabel?: string }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ name: "", ratePercent: "", hsnCode: "" });
  return <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> <LocalizedText value={"Add tax group"} /></Button>} title="Add a tax group" description="This tax group and its product assignments belong to this store alone.">
    <form className="grid gap-4 pb-6" onSubmit={async (e) => {
      e.preventDefault();
      const rate = Number(v.ratePercent);
      if (v.name.trim().length < 2 || !Number.isFinite(rate) || rate < 0 || rate > 100) { toast.error(`Enter a name and a ${taxLabel} rate between 0 and 100.`); return; }
      if (await run(() => send("/pos/v1/tax-groups", "POST", { storeId, name: v.name.trim(), ratePercent: rate, hsnCode: v.hsnCode.trim() }, storeId), "Tax group added")) { setOpen(false); setV({ name: "", ratePercent: "", hsnCode: "" }); }
    }}>
      <L label="Name"><Input value={v.name} onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))} placeholder={`e.g. ${taxLabel} 5%`} /></L>
      <L label={`${taxLabel} rate (%)`}><Input value={v.ratePercent} onChange={(e) => setV((c) => ({ ...c, ratePercent: e.target.value }))} inputMode="decimal" /></L>
      <L label={codeLabel} hint="Optional."><Input value={v.hsnCode} onChange={(e) => setV((c) => ({ ...c, hsnCode: e.target.value }))} /></L>
      <SheetFooter busy={busy} label="Add tax group" />
    </form>
  </FormSheet>;
}

export type StoreTaxGroup = { id: string; name: string; code: string; hsnCode: string; ratePercent: number; includesTax: boolean; status: "ACTIVE" | "DISABLED" };
export function StoreTaxGroupsList({ storeId, groups, canEdit, taxLabel = "GST", codeLabel = "HSN" }: { storeId: string; groups: StoreTaxGroup[]; canEdit: boolean; taxLabel?: string; codeLabel?: string }) {
  const { busy, run } = useRun();
  const [editing, setEditing] = React.useState<string | null>(null);
  if (!groups.length) return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground"><LocalizedText value={"No tax groups yet. Add the rates this store uses, then assign each product below."} /></p>;
  return <div className="divide-y rounded-md border bg-card">
    {groups.map((group) => <div key={group.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
      <div className="min-w-0 flex-1"><p className="font-medium">{group.name} {group.status === "DISABLED" && <Badge tone="warning"><LocalizedText value={"Off"} /></Badge>}</p><p className="text-xs text-muted-foreground">{group.ratePercent}% {taxLabel}{group.hsnCode ? ` · ${codeLabel} ${group.hsnCode}` : ""}<LocalizedText value={group.includesTax ? " · price includes tax" : ""} /></p></div>
      {canEdit && <div className="flex gap-2">
        <FormSheet open={editing === group.id} onOpenChange={(open) => setEditing(open ? group.id : null)} trigger={<Button size="sm" variant="outline"><LocalizedText value={"Edit"} /></Button>} title={`Edit ${group.name}`}>
          <StoreTaxGroupEditor storeId={storeId} group={group} taxLabel={taxLabel} codeLabel={codeLabel} onDone={() => setEditing(null)} />
        </FormSheet>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => send(`/pos/v1/tax-groups/${group.id}`, "PATCH", { storeId, status: group.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }, storeId), group.status === "ACTIVE" ? "Tax group turned off" : "Tax group turned on")}><LocalizedText value={group.status === "ACTIVE" ? "Turn off" : "Turn on"} /></Button>
      </div>}
    </div>)}
  </div>;
}

function StoreTaxGroupEditor({ storeId, group, taxLabel = "GST", codeLabel = "HSN / SAC", onDone }: { storeId: string; group: StoreTaxGroup; taxLabel?: string; codeLabel?: string; onDone: () => void }) {
  const { busy, run } = useRun();
  const [value, setValue] = React.useState({ name: group.name, rate: String(group.ratePercent), hsnCode: group.hsnCode, includesTax: group.includesTax });
  return <form className="grid gap-4 pb-6" onSubmit={async (event) => {
    event.preventDefault();
    const ratePercent = Number(value.rate);
    if (value.name.trim().length < 2 || !Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) { toast.error("Enter a name and a rate from 0% to 100%."); return; }
    if (await run(() => send(`/pos/v1/tax-groups/${group.id}`, "PATCH", { storeId, name: value.name.trim(), ratePercent, hsnCode: value.hsnCode.trim(), includesTax: value.includesTax }, storeId), "Tax group updated")) onDone();
  }}>
    <L label="Name"><Input value={value.name} onChange={(event) => setValue((current) => ({ ...current, name: event.target.value }))} /></L>
    <L label={`${taxLabel} rate (%)`}><Input value={value.rate} onChange={(event) => setValue((current) => ({ ...current, rate: event.target.value }))} inputMode="decimal" /></L>
    <L label={codeLabel} hint="Optional."><Input value={value.hsnCode} onChange={(event) => setValue((current) => ({ ...current, hsnCode: event.target.value }))} /></L>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includesTax} onChange={(event) => setValue((current) => ({ ...current, includesTax: event.target.checked }))} /> <LocalizedText value={`Product prices using this group include ${taxLabel}`} /></label>
    <SheetFooter busy={busy} label="Save tax group" />
  </form>;
}

export function StoreTaxAssignmentTable({ storeId, items, groups, canEdit }: { storeId: string; items: { variantId: string; sku: string; name: string; storeTaxGroupId: string | null; taxGroupName: string | null; taxRatePercent: number }[]; groups: StoreTaxGroup[]; canEdit: boolean }) {
  const { busy, run } = useRun();
  const router = useRouter();
  const activeGroups = groups.filter((group) => group.status === "ACTIVE");
  const rows = items;
  if (!rows.length) return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground"><LocalizedText value={"Assign organization catalog products to this store to configure their tax."} /></p>;
  return <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[540px] text-start text-sm"><thead><tr className="border-b bg-muted/40"><th className="p-3"><LocalizedText value={"Product"} /></th><th className="p-3"><LocalizedText value={"SKU"} /></th><th className="p-3"><LocalizedText value={"Tax group"} /></th></tr></thead><tbody>
    {rows.map((item) => <tr className="border-b last:border-0" key={item.variantId}><td className="p-3 font-medium">{item.name}</td><td className="p-3 font-mono text-xs">{item.sku}</td><td className="p-3"><NativeSelect aria-label={`Tax group for ${item.name}`} className="min-w-48" disabled={!canEdit || busy} value={item.storeTaxGroupId ?? ""} onChange={async (event) => { const ok = await run(() => send("/pos/v1/store-products", "PATCH", { storeId, variantId: item.variantId, taxGroupId: event.target.value || null }, storeId), "Product tax assignment saved"); if (ok) router.refresh(); }}><option value=""><LocalizedText value={"No tax group assigned"} /></option>{activeGroups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.ratePercent}%</option>)}</NativeSelect></td></tr>)}
  </tbody></table></div>;
}

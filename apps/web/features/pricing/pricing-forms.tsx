"use client";
/* Additional charges and store tax groups. Organisation-wide records are managed under Organisation → Catalogue;
   each store adds its own on the store's "Tax & charges" page. The API checks the permission on every call. */
import * as React from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormSheet } from "@/components/form/dialogs";
import { L, SheetFooter, rupeesToPaise, send, useRun } from "@/features/actions";
import type { ChargeRow } from "@/features/types";

type TaxOption = { id: string; name: string; ratePercent: number };

const describeValue = (charge: ChargeRow) => charge.kind === "FLAT" ? `₹${((charge.amountCents ?? 0) / 100).toFixed(2)}` : `${charge.ratePercent}%`;
const describeApplies = (charge: ChargeRow) => charge.applies === "PER_ITEM" ? (charge.kind === "FLAT" ? "per item" : "on each item") : "per bill";

export function ChargeForm({ storeId, taxGroups, charge, onDone }: { storeId?: string; taxGroups: TaxOption[]; charge?: ChargeRow; onDone: () => void }) {
  const { busy, run } = useRun();
  const [v, setV] = React.useState({
    name: charge?.name ?? "",
    kind: charge?.kind ?? "FLAT",
    value: charge ? (charge.kind === "FLAT" ? ((charge.amountCents ?? 0) / 100).toFixed(2) : String(charge.ratePercent ?? 0)) : "",
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
      <L label="Type"><NativeSelect value={v.kind} onChange={set("kind")}><option value="FLAT">Fixed amount (₹)</option><option value="PERCENT">Percentage of the bill (%)</option></NativeSelect></L>
      <L label={v.kind === "FLAT" ? "Amount (₹)" : "Percentage (%)"}><Input value={v.value} onChange={set("value")} inputMode="decimal" /></L>
    </div>
    <L label="Applies" hint={v.kind === "FLAT" ? "Per bill is charged once; per item is charged for every unit sold." : "Percentages are taken on the bill value before GST."}><NativeSelect value={v.applies} onChange={set("applies")}><option value="PER_BILL">Once per bill</option><option value="PER_ITEM">For every item</option></NativeSelect></L>
    <L label="GST on this charge" hint="Optional."><NativeSelect value={v.taxGroupId} onChange={set("taxGroupId")}><option value="">No GST</option>{taxGroups.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.ratePercent}%</option>)}</NativeSelect></L>
    <SheetFooter busy={busy} label={charge ? "Save charge" : "Add charge"} />
  </form>;
}

export function NewChargeSheet({ storeId, taxGroups }: { storeId?: string; taxGroups: TaxOption[] }) {
  const [open, setOpen] = React.useState(false);
  return <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> Add charge</Button>} title={storeId ? "Add a charge for this store" : "Add an organisation-wide charge"} description={storeId ? "Applies to bills in this store only, on top of any organisation-wide charges." : "Applies to bills in every store."}>
    <ChargeForm storeId={storeId} taxGroups={taxGroups} onDone={() => setOpen(false)} />
  </FormSheet>;
}

/** Table of charges. `editableScope` is the scope this screen may edit; the other scope is shown read-only. */
export function ChargesList({ charges, storeId, taxGroups, canEdit }: { charges: ChargeRow[]; storeId?: string; taxGroups: TaxOption[]; canEdit: boolean }) {
  const { busy, run } = useRun();
  const [editing, setEditing] = React.useState<string | null>(null);
  if (charges.length === 0) return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No additional charges yet.</p>;
  return <div className="divide-y rounded-md border bg-card">
    {charges.map((charge) => {
      const mine = canEdit && (storeId ? charge.storeId === storeId : charge.storeId === null);
      return <div key={charge.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{charge.name} <Badge tone={charge.scope === "ORGANISATION" ? "brand" : "neutral"}>{charge.scope === "ORGANISATION" ? "Organisation" : "This store"}</Badge> {charge.status === "DISABLED" && <Badge tone="warning">Off</Badge>}</p>
          <p className="text-xs text-muted-foreground">{describeValue(charge)} {describeApplies(charge)}{charge.taxGroupName ? ` · GST ${charge.taxRatePercent}% (${charge.taxGroupName})` : " · no GST"}</p>
        </div>
        {mine && <div className="flex gap-1.5">
          <FormSheet open={editing === charge.id} onOpenChange={(o) => setEditing(o ? charge.id : null)} trigger={<Button size="sm" variant="outline">Edit</Button>} title={`Edit ${charge.name}`}>
            <ChargeForm storeId={storeId} taxGroups={taxGroups} charge={charge} onDone={() => setEditing(null)} />
          </FormSheet>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => send(`/pos/v1/charges/${charge.id}`, "PATCH", { ...(storeId ? { storeId } : {}), status: charge.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }, storeId), charge.status === "ACTIVE" ? "Charge turned off" : "Charge turned on")}>{charge.status === "ACTIVE" ? "Turn off" : "Turn on"}</Button>
        </div>}
      </div>;
    })}
  </div>;
}

export function NewStoreTaxGroupSheet({ storeId }: { storeId: string }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ name: "", ratePercent: "", hsnCode: "" });
  return <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> Add tax group</Button>} title="Add a tax group for this store" description="Only this store can see and use it. Organisation-wide tax groups are already available.">
    <form className="grid gap-4 pb-6" onSubmit={async (e) => {
      e.preventDefault();
      const rate = Number(v.ratePercent);
      if (v.name.trim().length < 2 || !Number.isFinite(rate) || rate < 0 || rate > 100) { toast.error("Enter a name and a GST rate between 0 and 100."); return; }
      if (await run(() => send("/pos/v1/tax-groups", "POST", { storeId, name: v.name.trim(), ratePercent: rate, hsnCode: v.hsnCode.trim() }, storeId), "Tax group added")) { setOpen(false); setV({ name: "", ratePercent: "", hsnCode: "" }); }
    }}>
      <L label="Name"><Input value={v.name} onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))} placeholder="e.g. GST 5%" /></L>
      <L label="GST rate (%)"><Input value={v.ratePercent} onChange={(e) => setV((c) => ({ ...c, ratePercent: e.target.value }))} inputMode="decimal" /></L>
      <L label="HSN / SAC" hint="Optional."><Input value={v.hsnCode} onChange={(e) => setV((c) => ({ ...c, hsnCode: e.target.value }))} /></L>
      <SheetFooter busy={busy} label="Add tax group" />
    </form>
  </FormSheet>;
}

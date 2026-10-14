"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import { currencyCode, toInput, toMinor } from "@/lib/format";

const TENDERS: [string, string][] = [["CASH", "Cash"], ["CARD", "Card"], ["UPI", "UPI / QR"], ["WALLET", "Wallet"], ["POINTS", "Loyalty points"], ["OTHER", "Other"]];
type Values = {
  receiptFooter?: string; enabledTenders?: string[]; cashRounding?: number; requireDiscountReasonCode?: boolean;
  holdTtlHours?: number; pointValueCents?: number; cashMovementApprovalCents?: number; cashVarianceToleranceCents?: number;
  requireBillHandler?: boolean; lineDiscountEnabled?: boolean; billDiscountEnabled?: boolean;
  lineDiscountMaxPercent?: number; billDiscountMaxPercent?: number; allowDiscountStacking?: boolean;
};
type Key = keyof Values;
function SettingsGroup({ title, children, initiallyOpen = false }: { title: string; children: React.ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = React.useState(initiallyOpen);
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-md border px-3"><summary className="cursor-pointer py-3 text-sm font-semibold">{title}</summary><div className="grid gap-4 border-t py-4">{children}</div></details>;
}

const DEFAULTS: Required<Values> = {
  receiptFooter: "", enabledTenders: ["CASH", "CARD", "UPI"], cashRounding: 0, requireDiscountReasonCode: false,
  holdTtlHours: 24, pointValueCents: 1, cashMovementApprovalCents: 0, cashVarianceToleranceCents: 0,
  requireBillHandler: false, lineDiscountEnabled: true, billDiscountEnabled: true,
  lineDiscountMaxPercent: 100, billDiscountMaxPercent: 100, allowDiscountStacking: true,
};

/** Every value is configured and stored by this store. */
export function BillingForm({ storeId, own, canEdit = true }: { storeId: string; own: Values; canEdit?: boolean }) {
  const router = useRouter();
  const value = (key: Key) => (own[key] ?? DEFAULTS[key]) as never;
  const [footer, setFooter] = React.useState(String(value("receiptFooter")));
  const [tenders, setTenders] = React.useState<string[]>(value("enabledTenders") as string[]);
  const [rounding, setRounding] = React.useState(toInput(value("cashRounding") as number));
  const [reason, setReason] = React.useState(Boolean(value("requireDiscountReasonCode")));
  const [requireHandler, setRequireHandler] = React.useState(Boolean(value("requireBillHandler")));
  const [hold, setHold] = React.useState(String(value("holdTtlHours")));
  const [point, setPoint] = React.useState(toInput(value("pointValueCents") as number));
  const [cashApproval, setCashApproval] = React.useState(toInput(value("cashMovementApprovalCents") as number));
  const [varianceTolerance, setVarianceTolerance] = React.useState(toInput(value("cashVarianceToleranceCents") as number));
  const [lineEnabled, setLineEnabled] = React.useState(Boolean(value("lineDiscountEnabled")));
  const [billEnabled, setBillEnabled] = React.useState(Boolean(value("billDiscountEnabled")));
  const [lineMax, setLineMax] = React.useState(String(value("lineDiscountMaxPercent")));
  const [billMax, setBillMax] = React.useState(String(value("billDiscountMaxPercent")));
  const [stacking, setStacking] = React.useState(Boolean(value("allowDiscountStacking")));
  const [busy, setBusy] = React.useState(false);

  async function save() {
    const lineDiscountMaxPercent = Number(lineMax);
    const billDiscountMaxPercent = Number(billMax);
    const billing: Required<Values> = {
      receiptFooter: footer, enabledTenders: tenders, cashRounding: toMinor(rounding || "0"), requireDiscountReasonCode: reason,
      holdTtlHours: Number(hold), pointValueCents: toMinor(point || "0"), cashMovementApprovalCents: toMinor(cashApproval || "0"),
      cashVarianceToleranceCents: toMinor(varianceTolerance || "0"), requireBillHandler: requireHandler,
      lineDiscountEnabled: lineEnabled, billDiscountEnabled: billEnabled, lineDiscountMaxPercent,
      billDiscountMaxPercent, allowDiscountStacking: stacking,
    };
    if (!billing.enabledTenders.length) { toast.error("Keep at least one payment method on."); return; }
    if (!Number.isInteger(billing.cashRounding) || billing.cashRounding < 0) { toast.error("Cash rounding must be 0 or a positive amount."); return; }
    if (!Number.isInteger(billing.holdTtlHours) || billing.holdTtlHours < 1 || billing.holdTtlHours > 720) { toast.error("Held bills expire after 1 to 720 hours."); return; }
    if (!Number.isInteger(billing.pointValueCents) || billing.pointValueCents < 1) { toast.error("A loyalty point must be worth a positive amount."); return; }
    if (![billing.cashMovementApprovalCents, billing.cashVarianceToleranceCents].every((amount) => Number.isInteger(amount) && amount >= 0)) { toast.error("Cash limits must be zero or a positive whole amount."); return; }
    if (![lineDiscountMaxPercent, billDiscountMaxPercent].every((percent) => Number.isFinite(percent) && percent >= 0 && percent <= 100)) { toast.error("Discount limits must be between 0% and 100%."); return; }
    setBusy(true);
    try {
      await clientApi(`/admin/stores/${storeId}/settings`, { method: "PATCH", body: JSON.stringify({ billing }) });
      toast.success("Store billing settings saved");
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save billing settings"); }
    finally { setBusy(false); }
  }

  const textInput = (value: string, set: (value: string) => void, props: React.ComponentProps<typeof Input> = {}) => <Input {...props} value={value} onChange={(event) => set(event.target.value)} />;
  const setting = (label: string, hint: string, control: React.ReactNode) => <div className="grid gap-1.5"><span className="text-sm font-medium">{label}</span>{control}<span className="text-xs text-muted-foreground">{hint}</span></div>;
  const toggle = (label: string, checked: boolean, onChange: (checked: boolean) => void, hint?: string) => <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span></label>;
  const details = (title: string, children: React.ReactNode, initiallyOpen = false) => <SettingsGroup title={title} initiallyOpen={initiallyOpen}>{children}</SettingsGroup>;

  return <fieldset disabled={!canEdit} className="m-0 grid min-w-0 gap-3 border-0 p-0">
    <p className="text-sm text-muted-foreground">These settings apply only to this store. Product field definitions are managed from the organization catalog.</p>
    <div className="grid gap-3 xl:grid-cols-2">
      {details("Payments and checkout", <>
        <div className="grid gap-2"><span className="text-sm font-medium">Payment methods offered</span><div className="grid gap-2 sm:grid-cols-2">{TENDERS.map(([key, name]) => <label key={key} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><input type="checkbox" checked={tenders.includes(key)} onChange={(event) => setTenders((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} /> {name}</label>)}</div></div>
        {setting(`Cash rounding (${currencyCode()}, 0 = off)`, "Rounds cash totals to this amount.", textInput(rounding, setRounding, { inputMode: "decimal" }))}
        {toggle("Require a bill handler selection", requireHandler, setRequireHandler, "When off, the signed-in cashier is recorded by default.")}
      </>, true)}
      {details("Discount rules", <>
        {toggle("Allow line-item discounts", lineEnabled, setLineEnabled, "Cashiers can discount an individual product on the bill.")}
        {lineEnabled && setting("Maximum line discount (%)", "Maximum a cashier can discount from one product line. The API enforces this limit.", textInput(lineMax, setLineMax, { type: "number", min: 0, max: 100, step: "0.1" }))}
        {toggle("Allow whole-bill discounts and coupons", billEnabled, setBillEnabled, "Enables manual bill discounts, coupon codes, and automatic offers.")}
        {billEnabled && setting("Maximum combined bill discount (%)", "Caps all discounts applied to the whole bill, including coupons and automatic offers.", textInput(billMax, setBillMax, { type: "number", min: 0, max: 100, step: "0.1" }))}
        {toggle("Allow a manual discount to stack with an offer", stacking, setStacking, "Turn off to allow only one of these discount sources on a bill.")}
        {toggle("Require a configured reason code", reason, setReason, "Cashiers must choose a store-owned reason when applying a manual discount.")}
        <p className="text-sm text-muted-foreground">Set discounts for a specific product, category, brand, or all products; manage whole-bill coupons and offers in <Link className="font-medium text-foreground underline" href={`/s/${storeId}/pricing`}>Offers &amp; price rules</Link>.</p>
      </>, true)}
    </div>
    <div className="grid gap-3 xl:grid-cols-2">
      {details("Held bills and loyalty", <>
        {setting("Held bill expiry (hours)", "Choose 1 to 720 hours.", textInput(hold, setHold, { type: "number", min: 1, max: 720 }))}
        {setting(`Loyalty point value (${currencyCode()})`, "Used when customers pay with points.", textInput(point, setPoint, { inputMode: "decimal" }))}
      </>) }
      {details("Register controls", <>
        {setting(`Cash movement approval (${currencyCode()})`, "Movements above this amount need another manager’s PIN. 0 disables it.", textInput(cashApproval, setCashApproval, { inputMode: "decimal" }))}
        {setting(`Cash count tolerance (${currencyCode()})`, "A larger difference needs manager review and a reason.", textInput(varianceTolerance, setVarianceTolerance, { inputMode: "decimal" }))}
      </>)}
    </div>
    {details("Receipt", setting("Receipt footer", "Printed below the bill (up to 300 characters).", textInput(footer, setFooter, { maxLength: 300 })))}
    {canEdit && <Button className="w-fit" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save store billing"}</Button>}
  </fieldset>;
}

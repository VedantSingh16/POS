"use client";
import { LocalizedText } from "@/components/i18n/localized-text";

/* Coupons / automatic offers, price rules and discount reasons. The API checks the permission on every call. */
import * as React from "react";
import { toast } from "@/lib/i18n/toast";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormSheet } from "@/components/form/dialogs";
import { L, SheetFooter, rupeesToPaise, send, useRun } from "@/features/actions";
import { currencyCode, formatDate, formatMoney, formatNumber, toMinor } from "@/lib/format";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@pos/shared/locale";

type Option = { id: string; name: string };
type Offer = { id: string; code: string; type: "PERCENT" | "AMOUNT"; value: number; minSubtotalCents: number; usageLimit: number | null; usageCount: number; perCustomerLimit: number | null; autoApply: boolean; stackable: boolean; endsAt: string | null; status: string };
type Rule = { id: string; name: string; priority: number; scope: string; scopeId: string | null; customerGroup: string | null; minQuantity: number; mode: "FIXED" | "AMOUNT_OFF" | "PERCENT_OFF"; value: number; status: string };
type Reason = { id: string; code: string; name: string; status: string };

const describeOffer = (o: Offer, locale: Locale) => <>{o.type === "PERCENT" ? <LocalizedText value={`${formatNumber(o.value, locale)}% off`} /> : <LocalizedText value={`${formatMoney(toMinor(o.value), locale)} off`} />}{o.minSubtotalCents ? <> <LocalizedText value={`over ${formatMoney(o.minSubtotalCents, locale)}`} /></> : null}</>;
const describeRule = (r: Rule, locale: Locale) => r.mode === "FIXED"
  ? <LocalizedText value={`price ${formatMoney(r.value, locale)}`} />
  : r.mode === "AMOUNT_OFF"
    ? <LocalizedText value={`${formatMoney(r.value, locale)} off`} />
    : <LocalizedText value={`${formatNumber(r.value / 100, locale)}% off`} />;

function NewOffer({ storeId }: { storeId: string }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ code: "", type: "PERCENT", value: "", min: "", limit: "", perCustomer: "", endsAt: "", autoApply: false, stackable: false });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((c) => ({ ...c, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  return <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> <LocalizedText value={"Add offer"} /></Button>} title="Add an offer" description="A coupon the cashier types in, or an offer that applies by itself.">
    <form className="grid gap-4 pb-6" onSubmit={async (e) => {
      e.preventDefault();
      const value = Number(v.value);
      if (v.code.trim().length < 2) { toast.error("Enter a code."); return; }
      if (!Number.isFinite(value) || value <= 0 || (v.type === "PERCENT" && value > 100)) { toast.error("Enter a valid value."); return; }
      const body = { storeId, code: v.code.trim(), type: v.type, value, minSubtotalCents: v.min ? rupeesToPaise(v.min) : 0, ...(v.limit ? { usageLimit: Number(v.limit) } : {}), ...(v.perCustomer ? { perCustomerLimit: Number(v.perCustomer) } : {}), ...(v.endsAt ? { endsAt: new Date(`${v.endsAt}T23:59:59`).toISOString() } : {}), autoApply: v.autoApply, stackable: v.stackable };
      if (await run(() => send("/pos/v1/promotions", "POST", body, storeId), "Offer added")) setOpen(false);
    }}>
      <L label="Code" hint="What the cashier types, e.g. DIWALI10."><Input value={v.code} onChange={set("code")} /></L>
      <div className="grid gap-4 sm:grid-cols-2">
        <L label="Type"><NativeSelect value={v.type} onChange={set("type")}><option value="PERCENT"><LocalizedText value={"Percentage off the bill"} /></option><option value="AMOUNT"><LocalizedText value={"Fixed amount off the bill"} /></option></NativeSelect></L>
        <L label={v.type === "PERCENT" ? "Percentage (%)" : `Amount (${currencyCode()})`}><Input value={v.value} onChange={set("value")} inputMode="decimal" /></L>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <L label={`Minimum bill (${currencyCode()})`} hint="Optional."><Input value={v.min} onChange={set("min")} inputMode="decimal" /></L>
        <L label="Valid until" hint="Optional."><Input type="date" value={v.endsAt} onChange={set("endsAt")} /></L>
        <L label="Total uses allowed" hint="Optional."><Input value={v.limit} onChange={set("limit")} inputMode="numeric" /></L>
        <L label="Uses per customer" hint="Optional. Needs a customer on the bill."><Input value={v.perCustomer} onChange={set("perCustomer")} inputMode="numeric" /></L>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.autoApply} onChange={set("autoApply")} /> <LocalizedText value={"Apply automatically (no code needed)"} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.stackable} onChange={set("stackable")} /> <LocalizedText value={"Can be combined with other stackable offers"} /></label>
      <SheetFooter busy={busy} label="Add offer" />
    </form>
  </FormSheet>;
}

function NewRule({ storeId, categories, brands, products }: { storeId: string; categories: Option[]; brands: Option[]; products: Option[] }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ name: "", scope: "ALL", scopeId: "", mode: "PERCENT_OFF", value: "", group: "", minQuantity: "", priority: "0" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((c) => ({ ...c, [k]: e.target.value, ...(k === "scope" ? { scopeId: "" } : {}) }));
  const targets = v.scope === "CATEGORY" ? categories : v.scope === "BRAND" ? brands : v.scope === "VARIANT" ? products : [];
  return <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> <LocalizedText value={"Add price rule"} /></Button>} title="Add a price rule" description="Discount a specific product or a broader product group, optionally for a customer group or minimum quantity. The first matching rule by priority wins.">
    <form className="grid gap-4 pb-6" onSubmit={async (e) => {
      e.preventDefault();
      const amount = Number(v.value);
      if (v.name.trim().length < 2) { toast.error("Give the rule a name."); return; }
      if (!Number.isFinite(amount) || amount < 0 || (v.mode === "PERCENT_OFF" && amount > 100)) { toast.error("Enter a valid value."); return; }
      if (v.scope !== "ALL" && !v.scopeId) { toast.error("Choose what the rule applies to."); return; }
      const value = v.mode === "PERCENT_OFF" ? Math.round(amount * 100) : rupeesToPaise(v.value);
      const body = { storeId, name: v.name.trim(), scope: v.scope, ...(v.scopeId ? { scopeId: v.scopeId } : {}), mode: v.mode, value, ...(v.group.trim() ? { customerGroup: v.group.trim() } : {}), ...(v.minQuantity ? { minQuantity: Number(v.minQuantity) } : {}), priority: Number(v.priority) || 0 };
      if (await run(() => send("/pos/v1/price-rules", "POST", body, storeId), "Price rule added")) setOpen(false);
    }}>
      <L label="Name"><Input value={v.name} onChange={set("name")} placeholder="e.g. Wholesale customers" /></L>
      <div className="grid gap-4 sm:grid-cols-2">
        <L label="Applies to"><NativeSelect value={v.scope} onChange={set("scope")}><option value="ALL"><LocalizedText value={"Every item"} /></option><option value="VARIANT"><LocalizedText value={"One product"} /></option><option value="CATEGORY"><LocalizedText value={"A category"} /></option><option value="BRAND"><LocalizedText value={"A brand"} /></option></NativeSelect></L>
        {v.scope !== "ALL" && <L label={v.scope === "CATEGORY" ? "Category" : v.scope === "BRAND" ? "Brand" : "Product"}><NativeSelect value={v.scopeId} onChange={set("scopeId")}><option value=""><LocalizedText value={"Choose…"} /></option>{targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></L>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <L label="Effect"><NativeSelect value={v.mode} onChange={set("mode")}><option value="PERCENT_OFF"><LocalizedText value={"Percentage off the price"} /></option><option value="AMOUNT_OFF"><LocalizedText value={"Amount off each unit"} /></option><option value="FIXED"><LocalizedText value={"Fixed price per unit"} /></option></NativeSelect></L>
        <L label={v.mode === "PERCENT_OFF" ? "Percentage (%)" : `Amount (${currencyCode()})`}><Input value={v.value} onChange={set("value")} inputMode="decimal" /></L>
        <L label="Customer group" hint="Optional, e.g. Wholesale. Leave empty for everyone."><Input value={v.group} onChange={set("group")} /></L>
        <L label="Minimum quantity" hint="Optional, for bulk prices."><Input value={v.minQuantity} onChange={set("minQuantity")} inputMode="decimal" /></L>
        <L label="Priority" hint="Higher numbers are checked first."><Input value={v.priority} onChange={set("priority")} inputMode="numeric" /></L>
      </div>
      <p className="text-xs text-muted-foreground"><LocalizedText value={"Rules for one specific item are set through the API for now; category, brand and everything-rules are available here."} /></p>
      <SheetFooter busy={busy} label="Add rule" />
    </form>
  </FormSheet>;
}

function NewReason({ storeId }: { storeId: string }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ code: "", name: "" });
  return <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> <LocalizedText value={"Add reason"} /></Button>} title="Add a discount reason" description="Cashiers pick one of these when they give a discount.">
    <form className="grid gap-4 pb-6" onSubmit={async (e) => {
      e.preventDefault();
      if (v.code.trim().length < 2 || v.name.trim().length < 2) { toast.error("Enter a code and a name."); return; }
      if (await run(() => send("/pos/v1/discount-reasons", "POST", { storeId, code: v.code.trim(), name: v.name.trim() }, storeId), "Reason added")) { setOpen(false); setV({ code: "", name: "" }); }
    }}>
      <L label="Code"><Input value={v.code} onChange={(e) => setV((c) => ({ ...c, code: e.target.value }))} placeholder="DAMAGED" /></L>
      <L label="Name"><Input value={v.name} onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))} placeholder="Damaged packaging" /></L>
      <SheetFooter busy={busy} label="Add reason" />
    </form>
  </FormSheet>;
}

function Section({ title, action, empty, children }: { title: string; action?: React.ReactNode; empty: string; children: React.ReactNode[] }) {
  return <Card><CardContent className="grid gap-3 p-4">
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold"><LocalizedText value={title} /></h2>{action}</div>
    {children.length === 0 ? <p className="rounded-md border p-6 text-center text-sm text-muted-foreground"><LocalizedText value={empty} /></p> : <div className="divide-y rounded-md border bg-card">{children}</div>}
  </CardContent></Card>;
}

export function OffersAndRules({ storeId, canManage, rules, reasons, promotions, categories, brands, products }: { storeId: string; canManage: boolean; rules: Rule[]; reasons: Reason[]; promotions: Offer[]; categories: Option[]; brands: Option[]; products: Option[] }) {
  const { locale } = useLocale();
  const { busy, run } = useRun();
  const toggle = (path: string, status: string, done: string) => void run(() => send(path, "PATCH", { storeId, status: status === "ACTIVE" ? "DISABLED" : "ACTIVE" }, storeId), done);
  const scopeName = (scope: string, id: string | null) => (scope === "CATEGORY" ? categories : scope === "BRAND" ? brands : products).find((item) => item.id === id)?.name ?? "";
  return <div className="grid gap-4">
    <Section title="Offers & coupons" action={canManage ? <NewOffer storeId={storeId} /> : undefined} empty="No offers yet.">
      {promotions.map((o) => <div key={o.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <div className="min-w-0 flex-1"><p className="font-medium">{o.code} {o.autoApply && <Badge tone="info"><LocalizedText value={"Automatic"} /></Badge>} {o.status !== "ACTIVE" && <Badge tone="warning"><LocalizedText value={"Off"} /></Badge>}</p>
          <p className="text-xs text-muted-foreground">{describeOffer(o, locale)} <LocalizedText value={"· used "} />{formatNumber(o.usageCount, locale)}{o.usageLimit ? <> <LocalizedText value={"of "} />{formatNumber(o.usageLimit, locale)}</> : null}{o.perCustomerLimit ? <> · <LocalizedText value={`${formatNumber(o.perCustomerLimit, locale)} per customer`} /></> : null}<LocalizedText value={o.stackable ? " · stackable" : ""} />{o.endsAt ? <> · <LocalizedText value={"until "} />{formatDate(o.endsAt, locale)}</> : null}</p></div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(`/pos/v1/promotions/${o.id}`, o.status, o.status === "ACTIVE" ? "Offer turned off" : "Offer turned on")}><LocalizedText value={o.status === "ACTIVE" ? "Turn off" : "Turn on"} /></Button>
      </div>)}
    </Section>
    <Section title="Price rules" action={canManage ? <NewRule storeId={storeId} categories={categories} brands={brands} products={products} /> : undefined} empty="No price rules. Every item sells at its base price.">
      {rules.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <div className="min-w-0 flex-1"><p className="font-medium">{r.name} {r.status !== "ACTIVE" && <Badge tone="warning"><LocalizedText value={"Off"} /></Badge>}</p>
          <p className="text-xs text-muted-foreground">{describeRule(r, locale)} · {r.scope === "ALL" ? <LocalizedText value={"every item"} /> : <><LocalizedText value={r.scope === "VARIANT" ? "product" : r.scope.toLowerCase()} /> {scopeName(r.scope, r.scopeId)}</>}{r.customerGroup ? <> · <LocalizedText value={`${r.customerGroup} customers`} /></> : null}{r.minQuantity > 1 ? <> · <LocalizedText value={`from ${formatNumber(r.minQuantity, locale)} units`} /></> : null} <LocalizedText value={"· priority "} />{formatNumber(r.priority, locale)}</p></div>
        {canManage && <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(`/pos/v1/price-rules/${r.id}`, r.status, r.status === "ACTIVE" ? "Rule turned off" : "Rule turned on")}><LocalizedText value={r.status === "ACTIVE" ? "Turn off" : "Turn on"} /></Button>}
      </div>)}
    </Section>
    <Section title="Discount reasons" action={canManage ? <NewReason storeId={storeId} /> : undefined} empty="No reasons yet. Cashiers can type a free-text reason.">
      {reasons.map((r) => <div key={r.id} className="flex items-center gap-3 p-3 text-sm">
        <p className="min-w-0 flex-1 font-medium">{r.name} <span className="text-xs font-normal text-muted-foreground">{r.code}</span> {r.status !== "ACTIVE" && <Badge tone="warning"><LocalizedText value={"Off"} /></Badge>}</p>
        {canManage && <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(`/pos/v1/discount-reasons/${r.id}`, r.status, r.status === "ACTIVE" ? "Reason turned off" : "Reason turned on")}><LocalizedText value={r.status === "ACTIVE" ? "Turn off" : "Turn on"} /></Button>}
      </div>)}
    </Section>
  </div>;
}

"use client";
import { LocalizedText } from "@/components/i18n/localized-text";

/* Small client-side actions that wire existing API endpoints to the UI. The API enforces every permission;
   <Can> only hides controls the signed-in user could never use. */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { SheetClose } from "@/components/ui/sheet";
import { ConfirmDialog, FormSheet } from "@/components/form/dialogs";
import { Can } from "@/components/app/session-context";
import { clientApi } from "@/features/client-api";
import type * as M from "@/features/types";
import { currencyCode, formatMoney, toMinor } from "@/lib/format";
import { useLocale } from "@/components/i18n/locale-provider";
import { ConfigurableFieldValues, type ConfiguredField } from "@/features/settings/configurable-field-values";
import { MARKETS } from "@pos/shared/markets";

export function useRun() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  async function run(task: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    try { await task(); toast.success(success); router.refresh(); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Something went wrong"); return false; }
    finally { setBusy(false); }
  }
  return { busy, run };
}
export const send = (path: string, method: string, body?: unknown, storeId?: string) =>
  clientApi(path, { method, ...(storeId ? { headers: { "x-store-id": storeId } } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
/** What a person typed as the smallest currency unit (baisa for OMR, paise for INR). */
export const rupeesToPaise = (value: string) => toMinor(value);
export function L({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm"><span className="font-medium"><LocalizedText value={label} /></span>{children}{hint && <span className="text-xs text-muted-foreground"><LocalizedText value={hint} /></span>}</label>;
}
export function SheetFooter({ busy, label, disabled }: { busy: boolean; label: string; disabled?: boolean }) {
  return <div className="flex justify-end gap-2 pt-2"><SheetClose asChild><Button type="button" variant="outline"><LocalizedText value={"Cancel"} /></Button></SheetClose><Button type="submit" disabled={busy || disabled}><LocalizedText value={busy ? "Saving…" : label} /></Button></div>;
}

/* ───────── Approvals and alerts ───────── */
export function ApprovalButtons({ id, status, storeId }: { id: string; status: string; storeId: string }) {
  const { busy, run } = useRun();
  if (status !== "PENDING") return null;
  return (
    <Can permission="approval.manage" storeId={storeId}>
      <div className="flex justify-end gap-1.5">
        <ConfirmDialog trigger={<Button size="sm" variant="outline" disabled={busy}><LocalizedText value={"Deny"} /></Button>} title="Deny this request?" description="The cashier will not be able to continue the controlled action." confirmLabel="Deny" destructive onConfirm={() => void run(() => send(`/pos/v1/approvals/${id}`, "PATCH", { status: "DENIED" }, storeId), "Request denied")} />
        <Button size="sm" disabled={busy} onClick={() => void run(() => send(`/pos/v1/approvals/${id}`, "PATCH", { status: "APPROVED" }, storeId), "Request approved")}><LocalizedText value={"Approve"} /></Button>
      </div>
    </Can>
  );
}
export function AckAlertButton({ id, storeId, status }: { id: string; storeId: string; status?: string }) {
  const { busy, run } = useRun();
  if (status === "RESOLVED") return <span className="text-xs text-muted-foreground"><LocalizedText value={"Resolved"} /></span>;
  return <Can permission="alert.manage" storeId={storeId}><div className="flex flex-wrap items-center justify-end gap-2">{(!status || status === "OPEN") ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => send(`/pos/v1/alerts/${id}`, "PATCH", { status: "ACKNOWLEDGED" }, storeId), "Alert acknowledged")}><LocalizedText value={"Acknowledge"} /></Button> : <span className="text-xs text-muted-foreground"><LocalizedText value={"Acknowledged"} /></span>}<Button size="sm" variant="ghost" disabled={busy} onClick={() => { const reason = window.prompt("Why is this alert resolved?")?.trim(); if (reason) void run(() => send(`/pos/v1/alerts/${id}`, "PATCH", { status: "RESOLVED", reason }, storeId), "Alert resolved"); }}><LocalizedText value={"Resolve"} /></Button></div></Can>;
}

/* ───────── Customers ───────── */
export function NewCustomerSheet({ stores }: { stores: { id: string; name: string; code: string }[] }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ storeId: stores[0]?.id ?? "", name: "", phone: "", email: "", business: false, taxNumber: "", legalName: "", billingAddress: "", groupName: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((c) => ({ ...c, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  return (
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button disabled={stores.length === 0}><Plus /> <LocalizedText value={"New customer"} /></Button>} title="New customer" description="Customers are shared across every store. The store below only decides whose permissions are used to add them.">
      <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); if (v.name.trim().length < 2) { toast.error("Enter the customer's name."); return; } if (v.business && v.taxNumber.trim().length === 0) { toast.error("A business customer needs a GSTIN."); return; } if (await run(() => send("/pos/v1/customers", "POST", { storeId: v.storeId, name: v.name.trim(), phone: v.phone.trim(), email: v.email.trim(), ...(v.groupName.trim() ? { groupName: v.groupName.trim() } : {}), ...(v.business ? { isBusiness: true, taxNumber: v.taxNumber.trim(), legalName: v.legalName.trim(), billingAddress: v.billingAddress.trim() } : {}) }, v.storeId), "Customer added")) { setOpen(false); setV((c) => ({ ...c, name: "", phone: "", email: "", business: false, taxNumber: "", legalName: "", billingAddress: "", groupName: "" })); } }}>
        <L label="Name"><Input value={v.name} onChange={set("name")} /></L>
        <L label="Phone"><Input value={v.phone} onChange={set("phone")} inputMode="tel" /></L>
        <L label="Email"><Input type="email" value={v.email} onChange={set("email")} /></L>
        <L label="Customer group" hint="Optional, e.g. Wholesale. Price rules can target a group."><Input value={v.groupName} onChange={set("groupName")} /></L>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.business} onChange={set("business")} /> <LocalizedText value={"Business customer (B2B, GST invoice)"} /></label>
        {v.business && <>
          <L label="GSTIN" hint="15 characters. The state is read from it and decides CGST/SGST or IGST on the invoice."><Input value={v.taxNumber} onChange={(e) => setV((c) => ({ ...c, taxNumber: e.target.value.toUpperCase() }))} maxLength={15} /></L>
          <L label="Legal name" hint="Printed on the invoice as the buyer."><Input value={v.legalName} onChange={set("legalName")} /></L>
          <L label="Billing address"><Input value={v.billingAddress} onChange={set("billingAddress")} /></L>
        </>}
        <L label="Add as store"><NativeSelect value={v.storeId} onChange={set("storeId")}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</NativeSelect></L>
        <SheetFooter busy={busy} label="Add customer" />
      </form>
    </FormSheet>
  );
}
export function CreditSheet({ customerId, stores }: { customerId: string; stores: { id: string; name: string }[] }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ type: "CREDIT", amount: "", storeId: stores[0]?.id ?? "" });
  return (
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button variant="outline"><LocalizedText value={"Adjust store credit"} /></Button>} title="Adjust store credit" description="Adds to or deducts from the customer's wallet. Recorded in the audit log.">
      <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); const cents = rupeesToPaise(v.amount); if (!Number.isInteger(cents) || cents <= 0) { toast.error("Enter an amount greater than zero."); return; } if (await run(() => send(`/pos/v1/customers/${customerId}/ledger`, "POST", { type: v.type, amountCents: cents, storeId: v.storeId || undefined }, v.storeId || undefined), "Store credit updated")) { setOpen(false); setV((c) => ({ ...c, amount: "" })); } }}>
        <L label="Action"><NativeSelect value={v.type} onChange={(e) => setV((c) => ({ ...c, type: e.target.value }))}><option value="CREDIT"><LocalizedText value={"Add credit"} /></option><option value="DEBIT"><LocalizedText value={"Deduct credit"} /></option></NativeSelect></L>
        <L label={`Amount (${currencyCode()})`}><Input value={v.amount} onChange={(e) => setV((c) => ({ ...c, amount: e.target.value }))} inputMode="decimal" /></L>
        <L label="Store"><NativeSelect value={v.storeId} onChange={(e) => setV((c) => ({ ...c, storeId: e.target.value }))}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></L>
        <SheetFooter busy={busy} label="Save" />
      </form>
    </FormSheet>
  );
}

/* ───────── Organisation profile ───────── */
export type OrgProfile = { name: string; legalName: string; tradeName: string; gstin: string; address: string; timezone: string; businessType: string; countryCode: string; taxProfileStatus: string };
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function OrgProfileForm({ initial }: { initial: OrgProfile }) {
  const { busy, run } = useRun();
  const [v, setV] = React.useState(initial);
  const set = (k: keyof OrgProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((c) => ({ ...c, [k]: e.target.value }));
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (v.name.trim().length < 2) { toast.error("Enter the organisation name."); return; } if (v.countryCode === "IN" && v.taxProfileStatus === "REGISTERED" && !GSTIN.test(v.gstin.trim().toUpperCase())) { toast.error("GSTIN must be 15 characters in the standard format when registered for GST."); return; } void run(() => send("/admin/organization", "PATCH", v), "Organisation profile saved"); }}>
      <L label="Organisation name"><Input value={v.name} onChange={set("name")} /></L>
      <L label="Country or region"><NativeSelect value={v.countryCode} onChange={set("countryCode")}>{MARKETS.map((market) => <option key={market.code} value={market.code}>{market.name}</option>)}</NativeSelect></L>
      <L label="Legal name"><Input value={v.legalName} onChange={set("legalName")} /></L>
      <L label="Trade name"><Input value={v.tradeName} onChange={set("tradeName")} /></L>
      <L label={v.countryCode === "IN" ? "GST registration" : "Tax registration"}>
        <NativeSelect value={v.taxProfileStatus} onChange={set("taxProfileStatus")}>
          <option value="NOT_REVIEWED"><LocalizedText value={"Not reviewed"} /></option>
          <option value="REGISTERED"><LocalizedText value={"Registered for tax"} /></option>
          <option value="NOT_REGISTERED"><LocalizedText value={"Not registered / not applicable"} /></option>
          <option value="UNSURE"><LocalizedText value={"Not sure yet"} /></option>
          {v.taxProfileStatus === "LEGACY" && <option value="LEGACY"><LocalizedText value={"Existing profile"} /></option>}
        </NativeSelect>
      </L>
      {v.countryCode === "IN" && v.taxProfileStatus === "REGISTERED" && <L label="GSTIN" hint="Printed on tax invoices."><Input value={v.gstin} onChange={set("gstin")} /></L>}
      <p className="text-xs text-muted-foreground sm:col-span-2"><LocalizedText value={"When tax is registered, each product needs an assigned tax group before it can be sold. “Not sure yet” pauses sales until this profile is reviewed."} /></p>
      <L label="Registered address"><Input value={v.address} onChange={set("address")} /></L>
      <L label="Time zone"><Input value={v.timezone} onChange={set("timezone")} /></L>
      <L label="Business type"><NativeSelect value={v.businessType} onChange={set("businessType")}><option value="RETAIL"><LocalizedText value={"Retail"} /></option><option value="GROCERY"><LocalizedText value={"Grocery"} /></option><option value="PHARMACY"><LocalizedText value={"Pharmacy"} /></option><option value="OTHER"><LocalizedText value={"Other"} /></option></NativeSelect></L>
      <div className="flex items-end justify-end sm:col-span-2"><Button type="submit" disabled={busy || !dirty}><LocalizedText value={busy ? "Saving…" : "Save profile"} /></Button></div>
    </form>
  );
}

/* ───────── Account (signed-in user) ───────── */
export function AccountForms({ firstName, lastName, email }: { firstName: string; lastName: string; email: string }) {
  const { busy, run } = useRun();
  const [name, setName] = React.useState({ firstName, lastName });
  const [pw, setPw] = React.useState({ current: "", next: "", confirm: "" });
  const [pin, setPin] = React.useState({ value: "", confirm: "" });
  return (
    <div className="grid max-w-2xl gap-5">
      <form className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!name.firstName.trim()) { toast.error("Enter your first name."); return; } void run(() => send("/auth/profile", "PATCH", name), "Name saved"); }}>
        <h2 className="font-semibold sm:col-span-2"><LocalizedText value={"Profile"} /></h2>
        <L label="First name"><Input value={name.firstName} onChange={(e) => setName((c) => ({ ...c, firstName: e.target.value }))} /></L>
        <L label="Last name"><Input value={name.lastName} onChange={(e) => setName((c) => ({ ...c, lastName: e.target.value }))} /></L>
        <L label="Sign-in email" hint="Contact your administrator to change this."><Input value={email} readOnly className="bg-secondary text-muted-foreground" /></L>
        <div className="flex items-end justify-end"><Button type="submit" disabled={busy}><LocalizedText value={"Save name"} /></Button></div>
      </form>
      <form className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (pw.next.length < 12) { toast.error("The new password must be at least 12 characters."); return; } if (pw.next !== pw.confirm) { toast.error("The two passwords do not match."); return; } if (await run(() => send("/auth/profile", "PATCH", { password: pw.next, currentPassword: pw.current }), "Password changed")) setPw({ current: "", next: "", confirm: "" }); }}>
        <h2 className="font-semibold sm:col-span-2"><LocalizedText value={"Change password"} /></h2>
        <L label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((c) => ({ ...c, current: e.target.value }))} /></L>
        <div className="hidden sm:block" />
        <L label="New password" hint="At least 12 characters."><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((c) => ({ ...c, next: e.target.value }))} /></L>
        <L label="Confirm new password"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((c) => ({ ...c, confirm: e.target.value }))} /></L>
        <div className="flex justify-end sm:col-span-2"><Button type="submit" disabled={busy || !pw.current || !pw.next}><LocalizedText value={"Change password"} /></Button></div>
      </form>
      <form className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (!/^\d{4,8}$/.test(pin.value)) { toast.error("The PIN must be 4 to 8 digits."); return; } if (pin.value !== pin.confirm) { toast.error("The two PIN entries do not match."); return; } if (await run(() => send("/auth/profile", "PATCH", { pin: pin.value }), "PIN changed")) setPin({ value: "", confirm: "" }); }}>
        <h2 className="font-semibold sm:col-span-2"><LocalizedText value={"Approval PIN"} /></h2>
        <p className="text-sm text-muted-foreground sm:col-span-2"><LocalizedText value={"Unlocks a till and confirms controlled actions. 4 to 8 digits."} /></p>
        <L label="New PIN"><Input type="password" inputMode="numeric" autoComplete="off" value={pin.value} onChange={(e) => setPin((c) => ({ ...c, value: e.target.value.replace(/\D/g, "").slice(0, 8) }))} /></L>
        <L label="Confirm PIN"><Input type="password" inputMode="numeric" autoComplete="off" value={pin.confirm} onChange={(e) => setPin((c) => ({ ...c, confirm: e.target.value.replace(/\D/g, "").slice(0, 8) }))} /></L>
        <div className="flex justify-end sm:col-span-2"><Button type="submit" disabled={busy || !pin.value}><LocalizedText value={"Change PIN"} /></Button></div>
      </form>
    </div>
  );
}

/* ───────── Registers, tax groups, users ───────── */
export function RegisterAdminActions({ id, name, status }: { id: string; name: string; status: string }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(name);
  const active = status === "ACTIVE";
  return (
    <Can permission="registers.manage">
      <div className="flex justify-end gap-1.5">
        <FormSheet open={open} onOpenChange={setOpen} trigger={<Button size="sm" variant="outline"><LocalizedText value={"Rename"} /></Button>} title="Rename register" description="The code stays the same.">
          <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); if (value.trim().length < 2) { toast.error("Enter a register name."); return; } if (await run(() => send(`/admin/registers/${id}`, "PATCH", { name: value.trim() }), "Register renamed")) setOpen(false); }}>
            <L label="Name"><Input value={value} onChange={(e) => setValue(e.target.value)} /></L><SheetFooter busy={busy} label="Save" />
          </form>
        </FormSheet>
        <ConfirmDialog trigger={<Button size="sm" variant="outline" disabled={busy}><LocalizedText value={active ? "Deactivate" : "Activate"} /></Button>} title={`${active ? "Deactivate" : "Activate"} ${name}?`} description={active ? "Nobody will be able to open this register until it is activated again. Sales history is kept." : "The register can be opened again."} confirmLabel={active ? "Deactivate" : "Activate"} destructive={active} onConfirm={() => void run(() => send(`/admin/registers/${id}`, "PATCH", { status: active ? "INACTIVE" : "ACTIVE" }), active ? "Register deactivated" : "Register activated")} />
      </div>
    </Can>
  );
}
export function EditTaxGroupSheet({ id, name, rate }: { id: string; name: string; rate: number }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ name, rate: String(rate) });
  return (
    <Can permission="tax.manage">
      <FormSheet open={open} onOpenChange={setOpen} trigger={<Button size="sm" variant="outline"><LocalizedText value={"Edit"} /></Button>} title={`Edit ${name}`} description="Existing sales keep the tax rate they were sold at.">
        <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); const r = Number(v.rate); if (v.name.trim().length < 2 || !Number.isFinite(r) || r < 0 || r > 100) { toast.error("Enter a name and a rate between 0 and 100."); return; } if (await run(() => send(`/admin/catalog/tax-groups/${id}`, "PATCH", { name: v.name.trim(), ratePercent: r }), "Tax group updated")) setOpen(false); }}>
          <L label="Name"><Input value={v.name} onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))} /></L>
          <L label="Rate (%)"><Input value={v.rate} onChange={(e) => setV((c) => ({ ...c, rate: e.target.value }))} inputMode="decimal" /></L>
          <SheetFooter busy={busy} label="Save" />
        </form>
      </FormSheet>
    </Can>
  );
}
export function UserAdminActions({ id, name, status, self }: { id: string; name: string; status: string; self: boolean }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const active = status === "ACTIVE";
  return (
    <Can permission="users.manage">
      <ConfirmDialog trigger={<Button variant="outline" disabled={busy || self} title={self ? "You cannot deactivate your own account" : undefined}><LocalizedText value={active ? "Deactivate" : "Reactivate"} /></Button>} title={`${active ? "Deactivate" : "Reactivate"} ${name}?`} description={active ? "They will be signed out of new sessions and cannot sign in until reactivated. Their history is kept." : "They will be able to sign in again with their existing password."} confirmLabel={active ? "Deactivate" : "Reactivate"} destructive={active} onConfirm={() => void run(() => send(`/admin/users/${id}`, "PATCH", { status: active ? "SUSPENDED" : "ACTIVE" }), active ? "User deactivated" : "User reactivated")} />
      <FormSheet open={open} onOpenChange={setOpen} trigger={<Button variant="outline"><LocalizedText value={"Reset password"} /></Button>} title={`Reset password for ${name}`} description="Set a new password and tell them securely. It also clears any sign-in lockout.">
        <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); if (password.length < 12) { toast.error("The password must be at least 12 characters."); return; } if (await run(() => send(`/admin/users/${id}`, "PATCH", { password }), "Password reset")) { setOpen(false); setPassword(""); } }}>
          <L label="New password" hint="At least 12 characters."><Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></L><SheetFooter busy={busy} label="Reset password" />
        </form>
      </FormSheet>
    </Can>
  );
}

/* ───────── Inventory ───────── */
export function ThresholdSheet({ storeId, locationId, variantId, name, reorderPoint }: { storeId: string; locationId: string; variantId: string; name: string; reorderPoint: number }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(String(reorderPoint));
  return (
    <Can permission="inventory.manage" storeId={storeId}>
      <FormSheet open={open} onOpenChange={setOpen} trigger={<Button size="sm" variant="ghost"><LocalizedText value={"Edit"} /></Button>} title={`Reorder level: ${name}`} description="A low-stock alert is raised when sellable stock falls to this number.">
        <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); const n = Number(value); if (!Number.isFinite(n) || n < 0) { toast.error("Enter zero or a positive number."); return; } if (await run(() => send("/pos/v1/inventory/thresholds", "PATCH", { locationId, variantId, reorderPoint: n }, storeId), "Reorder level saved")) setOpen(false); }}>
          <L label="Reorder level"><Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" /></L><SheetFooter busy={busy} label="Save" />
        </form>
      </FormSheet>
    </Can>
  );
}
export function RebuildStockButton({ storeId }: { storeId: string }) {
  const { busy, run } = useRun();
  return (
    <Can permission="inventory.manage" storeId={storeId}>
      <ConfirmDialog trigger={<Button variant="outline" disabled={busy}><LocalizedText value={"Rebuild stock balances"} /></Button>} title="Rebuild stock balances?" description="Recalculates this store's balances from the stock movement history. Reorder levels are kept. Use it only if balances look wrong." confirmLabel="Rebuild" onConfirm={() => void run(() => send(`/pos/v1/inventory/rebuild?storeId=${encodeURIComponent(storeId)}`, "POST", undefined, storeId), "Stock balances rebuilt")} />
    </Can>
  );
}
export function NewLocationSheet({ storeId }: { storeId: string }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ code: "", name: "" });
  return (
    <Can permission="inventory.manage" storeId={storeId}>
      <FormSheet open={open} onOpenChange={setOpen} trigger={<Button variant="outline"><Plus /> <LocalizedText value={"Stock location"} /></Button>} title="New stock location" description="A place stock is held in this store, such as a stockroom or damaged-goods bin.">
        <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); if (!/^[A-Za-z0-9-]{2,24}$/.test(v.code.trim()) || v.name.trim().length < 2) { toast.error("Enter a code (letters, numbers, hyphens) and a name."); return; } if (await run(() => send("/pos/v1/locations", "POST", { storeId, code: v.code.trim(), name: v.name.trim() }, storeId), "Stock location added")) { setOpen(false); setV({ code: "", name: "" }); } }}>
          <L label="Code"><Input value={v.code} onChange={(e) => setV((c) => ({ ...c, code: e.target.value }))} /></L>
          <L label="Name"><Input value={v.name} onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))} /></L><SheetFooter busy={busy} label="Add location" />
        </form>
      </FormSheet>
    </Can>
  );
}

/* ───────── Transfers (organisation level) ───────── */
export function NewTransferSheet({ locations, variants }: { locations: { id: string; name: string }[]; variants: { id: string; label: string }[] }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ from: locations[0]?.id ?? "", to: locations[1]?.id ?? "", variantId: variants[0]?.id ?? "", quantity: "", notes: "" });
  return (
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button disabled={locations.length < 2 || variants.length === 0}><Plus /> <LocalizedText value={"New transfer"} /></Button>} title="New stock transfer" description="Requests a move of one product between two stock locations. Stock leaves the source when you dispatch it and is added to the destination when it is received.">
      <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); const q = Number(v.quantity); if (v.from === v.to) { toast.error("Source and destination must differ."); return; } if (!Number.isFinite(q) || q <= 0) { toast.error("Enter a quantity greater than zero."); return; } if (await run(() => send("/pos/v1/transfers", "POST", { fromLocationId: v.from, toLocationId: v.to, notes: v.notes || undefined, lines: [{ variantId: v.variantId, quantity: q }] }), "Transfer requested")) { setOpen(false); setV((c) => ({ ...c, quantity: "", notes: "" })); } }}>
        <L label="From"><NativeSelect value={v.from} onChange={(e) => setV((c) => ({ ...c, from: e.target.value }))}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></L>
        <L label="To"><NativeSelect value={v.to} onChange={(e) => setV((c) => ({ ...c, to: e.target.value }))}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect></L>
        <L label="Product"><NativeSelect value={v.variantId} onChange={(e) => setV((c) => ({ ...c, variantId: e.target.value }))}>{variants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</NativeSelect></L>
        <L label="Quantity"><Input value={v.quantity} onChange={(e) => setV((c) => ({ ...c, quantity: e.target.value }))} inputMode="decimal" /></L>
        <L label="Notes (optional)"><Input value={v.notes} onChange={(e) => setV((c) => ({ ...c, notes: e.target.value }))} /></L>
        <SheetFooter busy={busy} label="Request transfer" />
      </form>
    </FormSheet>
  );
}
const NEXT: Record<string, { to: string; label: string }[]> = {
  REQUESTED: [{ to: "DISPATCHED", label: "Dispatch" }, { to: "CANCELLED", label: "Cancel" }],
  DISPATCHED: [{ to: "RECEIVED", label: "Mark received" }, { to: "CANCELLED", label: "Cancel" }],
  IN_TRANSIT: [{ to: "RECEIVED", label: "Mark received" }, { to: "CANCELLED", label: "Cancel" }],
};
export function TransferActions({ id, status }: { id: string; status: string }) {
  const { busy, run } = useRun();
  return (
    <Can permission="transfer.manage">
      <div className="flex justify-end gap-1.5">{(NEXT[status] ?? []).map((n) => n.to === "CANCELLED"
        ? <ConfirmDialog key={n.to} trigger={<Button size="sm" variant="outline" disabled={busy}><LocalizedText value={n.label} /></Button>} title="Cancel this transfer?" description="It cannot be reopened." confirmLabel="Cancel transfer" destructive onConfirm={() => void run(() => send(`/pos/v1/transfers/${id}`, "PATCH", { status: n.to }), "Transfer cancelled")} />
        : <Button key={n.to} size="sm" disabled={busy} onClick={() => void run(() => send(`/pos/v1/transfers/${id}`, "PATCH", { status: n.to }), n.to === "DISPATCHED" ? "Transfer dispatched" : "Transfer received")}><LocalizedText value={n.label} /></Button>)}</div>
    </Can>
  );
}

/* ───────── Catalogue: variants and units ───────── */
export function AddVariantSheet({ productId, uoms, customFieldDefinitions = [], coreFields, forceBarcode = false }: { productId: string; uoms: { id: string; code: string; name: string }[]; customFieldDefinitions?: ConfiguredField[]; coreFields?: string[]; forceBarcode?: boolean }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ sku: "", name: "", price: "", cost: "", barcode: "", uomId: "", includesTax: true, openPrice: false, floorPrice: "" });
  const [customFields, setCustomFields] = React.useState<Record<string, string | number | boolean>>({});
  const variantFields = customFieldDefinitions.filter((field) => field.level === "VARIANT");
  const visibleCore = coreFields ?? ["name", "description", "productType", "attributes", "brand", "category", "sku", "barcode", "price", "cost", "uom", "status", "openPrice", "floorPrice", "includesTax"];
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((c) => ({ ...c, [k]: e.target.value }));
  return (
    <Can permission="catalog.manage">
      <FormSheet open={open} onOpenChange={setOpen} trigger={<Button variant="outline"><Plus /> <LocalizedText value={"Add variant"} /></Button>} title="Add variant" description="A sellable version of this product, with its own SKU, barcode and price.">
        <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); const price = rupeesToPaise(v.price); const cost = v.cost ? rupeesToPaise(v.cost) : 0; const floorPriceCents = v.floorPrice ? rupeesToPaise(v.floorPrice) : 0; if (!v.sku.trim() || !v.name.trim()) { toast.error("Enter a SKU and a variant name."); return; } const missing = variantFields.find((field) => field.required && (customFields[field.key] === undefined || customFields[field.key] === "")); if (missing) { toast.error(`${missing.label} is required.`); return; } if (!Number.isInteger(price) || price < 0 || !Number.isInteger(cost) || cost < 0 || !Number.isInteger(floorPriceCents) || floorPriceCents < 0) { toast.error("Enter prices as rupee amounts, for example 499 or 499.50."); return; } if (await run(() => send(`/admin/catalog/products/${productId}/variants`, "POST", { sku: v.sku.trim(), name: v.name.trim(), amountCents: price, costCents: cost, includesTax: v.includesTax, openPrice: v.openPrice, floorPriceCents, barcode: v.barcode.trim() || undefined, uomId: v.uomId || undefined, customFields }), "Variant added")) { setOpen(false); setV({ sku: "", name: "", price: "", cost: "", barcode: "", uomId: "", includesTax: true, openPrice: false, floorPrice: "" }); setCustomFields({}); } }}>
          <L label="SKU"><Input value={v.sku} onChange={set("sku")} /></L>
          <L label="Variant name" hint="For example Medium / Blue."><Input value={v.name} onChange={set("name")} /></L>
          <div className="grid grid-cols-2 gap-3"><L label={`Selling price (${currencyCode()})`}><Input value={v.price} onChange={set("price")} inputMode="decimal" /></L>{visibleCore.includes("cost") && <L label={`Cost (${currencyCode()})`}><Input value={v.cost} onChange={set("cost")} inputMode="decimal" /></L>}</div>
          {visibleCore.includes("includesTax") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.includesTax} onChange={(e) => setV((c) => ({ ...c, includesTax: e.target.checked }))} /> <LocalizedText value={"Selling price includes tax"} /></label>}
          {visibleCore.includes("openPrice") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.openPrice} onChange={(e) => setV((c) => ({ ...c, openPrice: e.target.checked }))} /> <LocalizedText value={"Cashier may enter the price at checkout"} /></label>}
          {visibleCore.includes("floorPrice") && <L label={`Lowest open price (${currencyCode()})`}><Input value={v.floorPrice} onChange={(e) => setV((c) => ({ ...c, floorPrice: e.target.value }))} inputMode="decimal" /></L>}
          {(visibleCore.includes("barcode") || forceBarcode) && <L label="Barcode (optional)"><Input value={v.barcode} onChange={set("barcode")} /></L>}
          {visibleCore.includes("uom") && <L label="Unit of measure"><NativeSelect value={v.uomId} onChange={set("uomId")}><option value=""><LocalizedText value={"Not set"} /></option>{uoms.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}</NativeSelect></L>}
          <ConfigurableFieldValues fields={variantFields} values={customFields} onChange={setCustomFields} idPrefix={`new-variant-field-${productId}`} />
          <SheetFooter busy={busy} label="Add variant" />
        </form>
      </FormSheet>
    </Can>
  );
}
export function NewUomSheet() {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ code: "", name: "", allowsDecimal: false });
  return (
    <Can permission="catalog.manage">
      <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> <LocalizedText value={"Add unit"} /></Button>} title="Add a unit" description="Used for product quantities in inventory and sales. For example Piece, Kilogram, or Litre.">
        <form className="grid gap-4 pb-6" onSubmit={async (e) => { e.preventDefault(); if (!/^[A-Za-z0-9]{1,10}$/.test(v.code.trim()) || v.name.trim().length < 2) { toast.error("Enter a short code (letters and numbers) and a name."); return; } if (await run(() => send("/admin/catalog/uoms", "POST", { code: v.code.trim(), name: v.name.trim(), allowsDecimal: v.allowsDecimal }), "Unit added")) { setOpen(false); setV({ code: "", name: "", allowsDecimal: false }); } }}>
          <L label="Code"><Input value={v.code} onChange={(e) => setV((c) => ({ ...c, code: e.target.value }))} /></L>
          <L label="Name"><Input value={v.name} onChange={(e) => setV((c) => ({ ...c, name: e.target.value }))} /></L>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.allowsDecimal} onChange={(e) => setV((c) => ({ ...c, allowsDecimal: e.target.checked }))} /> <LocalizedText value={"Can be sold in fractions (for example 0.5 kg)"} /></label>
          <SheetFooter busy={busy} label="Add unit" />
        </form>
      </FormSheet>
    </Can>
  );
}

/* ───────── Store catalogue ───────── */
export function AddStoreProductsSheet({ storeId, items }: { storeId: string; items: M.StoreCatalogueItem[] }) {
  const { locale } = useLocale();
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [qty, setQty] = React.useState("");
  const available = items.filter((item) => !item.assigned && (!q.trim() || `${item.sku} ${item.name} ${item.brand}`.toLowerCase().includes(q.trim().toLowerCase())));
  const single = picked.length === 1;
  const toggle = (id: string) => setPicked((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);
  return (
    <Can permission="catalog.manage.store" storeId={storeId}>
      <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> <LocalizedText value={"Add products"} /></Button>} title="Add products to this store" description="Each store sells its own set of products. Pick from the organisation catalogue; create new products under Organisation → Catalogue.">
        <form className="grid gap-4 pb-6" onSubmit={async (e) => {
          e.preventDefault();
          if (!picked.length) { toast.error("Select at least one product."); return; }
          const body: Record<string, unknown> = { storeId, variantIds: picked };
          if (single && qty.trim()) { const n = Number(qty); if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid opening quantity."); return; } body.openingQuantity = n; }
          if (await run(() => send("/pos/v1/store-products", "POST", body, storeId), `${picked.length} product${picked.length === 1 ? "" : "s"} added`)) { setOpen(false); setPicked([]); setQty(""); }
        }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU, name or brand" aria-label="Search products" />
          <div className="max-h-72 overflow-y-auto rounded-md border">
            {available.length === 0 ? <p className="p-4 text-sm text-muted-foreground"><LocalizedText value={items.every((i) => i.assigned) ? "Every catalogue product is already in this store." : "No matching products."} /></p> : available.map((item) => (
              <label key={item.variantId} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-secondary">
                <input type="checkbox" checked={picked.includes(item.variantId)} onChange={() => toggle(item.variantId)} />
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{item.name}</span> <span className="text-muted-foreground">· {item.sku}</span></span>
                <span className="text-xs text-muted-foreground">{formatMoney(item.priceCents, locale)}</span>
              </label>
            ))}
          </div>
          {single && <L label="Opening stock" hint="Optional. Posted to this store's first stock location."><Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" /></L>}
          {picked.length > 1 && <p className="text-xs text-muted-foreground"><LocalizedText value={"Select one product to also set opening stock. Prices are set by the organisation."} /></p>}
          <SheetFooter busy={busy} label={`Add ${picked.length || ""} to store`.replace("  ", " ")} />
        </form>
      </FormSheet>
    </Can>
  );
}
export function StoreProductActions({ storeId, variantId, status }: { storeId: string; variantId: string; status: string | null }) {
  const { busy, run } = useRun();
  const active = status === "ACTIVE";
  return <Can permission="catalog.manage.store" storeId={storeId}><div className="flex justify-end"><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => send("/pos/v1/store-products", "PATCH", { storeId, variantId, status: active ? "DISABLED" : "ACTIVE" }, storeId), active ? "Removed from sale" : "Back on sale")}><LocalizedText value={active ? "Remove" : "Restore"} /></Button></div></Can>;
}
/* ───────── Pending verification (received from organisation) ───────── */
export function PendingVerificationList({ storeId, items, taxGroups, canReview }: { storeId: string; items: { variantId: string; sku: string; name: string; brand: string; category?: string; suggestedPriceCents: number; taxGroup: { id: string; name: string; rateBps: number } | null; pendingQuantity: number }[]; taxGroups: { id: string; name: string; rate: number }[]; canReview: boolean }) {
  return (
    <div className="divide-y rounded-md border bg-card">
      {items.map((item) => <PendingVerificationRow key={item.variantId} storeId={storeId} item={item} taxGroups={taxGroups} canReview={canReview} />)}
    </div>
  );
}
function PendingVerificationRow({ storeId, item, taxGroups, canReview }: { storeId: string; item: { variantId: string; sku: string; name: string; category?: string; suggestedPriceCents: number; taxGroup: { id: string; name: string } | null; pendingQuantity: number }; taxGroups: { id: string; name: string; rate: number }[]; canReview: boolean }) {
  const { locale } = useLocale();
  const { busy, run } = useRun();
  const [editing, setEditing] = React.useState(false);
  const [taxGroupId, setTaxGroupId] = React.useState(item.taxGroup?.id ?? "");
  async function accept(withTax: boolean) {
    const body: Record<string, unknown> = { storeId, variantId: item.variantId, action: "ACCEPT" };
    if (withTax) body.taxGroupId = taxGroupId || null;
    await run(() => send(`/pos/v1/store-products/verify`, "POST", body, storeId), "Added to your store and on sale");
  }
  async function reject() {
    await run(() => send(`/pos/v1/store-products/verify`, "POST", { storeId, variantId: item.variantId, action: "REJECT" }, storeId), "Rejected");
  }
  return (
    <div className="flex flex-wrap items-start gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground"><LocalizedText value={"SKU "} />{item.sku}{item.category ? ` · ${item.category}` : ""} · {item.pendingQuantity} <LocalizedText value={"units pending · price "} />{formatMoney(item.suggestedPriceCents, locale)} <LocalizedText value={"(set by organisation)"} />{item.taxGroup ? ` · ${item.taxGroup.name}` : ""}</p>
        {editing && <div className="mt-2 sm:max-w-xs">
          <L label="Tax group for this store"><NativeSelect value={taxGroupId} onChange={(e) => setTaxGroupId(e.target.value)}><option value=""><LocalizedText value={"Choose this store's tax group"} /></option>{taxGroups.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.rate}%</option>)}</NativeSelect></L>
        </div>}
      </div>
      {!canReview ? <span className="rounded-full bg-warning-soft px-2 py-1 text-xs font-medium text-warning"><LocalizedText value={"Awaiting store review"} /></span> : <div className="flex gap-2">
        {!editing && <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}><LocalizedText value={"Choose tax"} /></Button>}
        <Button size="sm" disabled={busy} onClick={() => void accept(editing)}><LocalizedText value={"Add to store"} /></Button>
        <ConfirmDialog trigger={<Button size="sm" variant="outline" disabled={busy}><LocalizedText value={"Reject"} /></Button>} title="Reject this item?" description="Stock returns to quarantine and this product is marked disabled in your store." confirmLabel="Reject" destructive onConfirm={() => void reject()} />
      </div>}
    </div>
  );
}

/* ───────── Distributions (organisation pushes to a store) ───────── */
export function NewDistributionSheet({ stores, variants }: { stores: { id: string; name: string; code: string }[]; variants: { id: string; label: string; defaultPriceCents: number }[] }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [toStoreId, setToStoreId] = React.useState(stores[0]?.id ?? "");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<{ variantId: string; quantity: string }[]>([]);
  const add = () => setLines((c) => [...c, { variantId: variants[0]?.id ?? "", quantity: "0" }]);
  const remove = (i: number) => setLines((c) => c.filter((_, k) => k !== i));
  const updateLine = (i: number, patch: Partial<{ variantId: string; quantity: string }>) => setLines((c) => c.map((l, k) => k === i ? { ...l, ...patch } : l));
  return (
    <Can permission="catalog.distribute">
      <FormSheet open={open} onOpenChange={setOpen} trigger={<Button disabled={stores.length === 0 || variants.length === 0}><Plus /> <LocalizedText value={"New distribution"} /></Button>} title="Send products to a store" description="Pick a store and the products. They arrive as Pending; the store chooses when to add them. Quantity can be 0 to send the product without stock. Prices stay the organisation base price.">
        <form className="grid gap-4 pb-6" onSubmit={async (e) => {
          e.preventDefault();
          if (!toStoreId) { toast.error("Pick a store."); return; }
          if (lines.length === 0) { toast.error("Add at least one product."); return; }
          const body = { toStoreId, notes, dispatch: true, lines: lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity || 0) })) };
          if (body.lines.some((l) => !l.variantId || !Number.isFinite(l.quantity) || l.quantity < 0)) { toast.error("Every line needs a product and a quantity of 0 or more."); return; }
          if (await run(() => send("/pos/v1/distributions", "POST", body), "Sent to the store as Pending")) { setOpen(false); setLines([]); setNotes(""); }
        }}>
          <L label="Destination store"><NativeSelect value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</NativeSelect></L>
          <L label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></L>
          <div className="grid gap-2">
            <div className="flex items-center justify-between"><span className="text-sm font-medium"><LocalizedText value={"Products"} /></span><Button type="button" size="sm" variant="outline" onClick={add}><Plus /> <LocalizedText value={"Add product"} /></Button></div>
            {lines.length === 0 && <p className="text-sm text-muted-foreground"><LocalizedText value={"No products yet."} /></p>}
            {lines.map((line, i) => (
              <div className="grid grid-cols-[1fr_90px_auto] items-end gap-2" key={i}>
                <L label={i === 0 ? "Product" : ""}><NativeSelect value={line.variantId} onChange={(e) => updateLine(i, { variantId: e.target.value })}>{variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</NativeSelect></L>
                <L label={i === 0 ? "Qty" : ""}><Input value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} inputMode="decimal" /></L>
                <Button type="button" size="sm" variant="outline" onClick={() => remove(i)}><LocalizedText value={"Remove"} /></Button>
              </div>
            ))}
          </div>
          <SheetFooter busy={busy} label="Send to store" disabled={lines.length === 0} />
        </form>
      </FormSheet>
    </Can>
  );
}

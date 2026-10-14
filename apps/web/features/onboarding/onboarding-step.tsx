"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { clientApi } from "@/features/client-api";
import { CURRENCIES } from "@pos/shared/currency";
import { MARKETS, marketByCode } from "@pos/shared/markets";

type OrganizationDraft = {
  name: string;
  countryCode: string;
  currency: string;
  businessType: string;
  timezone: string;
  taxProfileStatus: string;
  gstin: string;
};
type StoreDraft = { name: string; address: string; city: string; region: string; postalCode: string; phone: string; timezone: string };
type Props = {
  currentStep: number;
  initialData: Record<string, unknown>;
  organization: { name: string; maxStores: number; countryCode: string; currency: string; timezone: string; taxProfileStatus: string };
  admin: { email: string };
  complete: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function OnboardingStep({ currentStep, initialData, organization, admin, complete }: Props) {
  const router = useRouter();
  const initialOrg = asRecord(initialData.organization);
  const initialStore = asRecord(initialData.store);
  const [orgState, setOrgState] = React.useState<OrganizationDraft>({
    name: String(initialOrg.name ?? organization.name),
    countryCode: String(initialOrg.countryCode ?? organization.countryCode),
    currency: String(initialOrg.currency ?? organization.currency),
    businessType: String(initialOrg.businessType ?? "RETAIL"),
    timezone: String(initialOrg.timezone ?? organization.timezone),
    taxProfileStatus: ["REGISTERED", "NOT_REGISTERED", "UNSURE"].includes(String(initialOrg.taxProfileStatus ?? organization.taxProfileStatus)) ? String(initialOrg.taxProfileStatus ?? organization.taxProfileStatus) : "",
    gstin: String(initialOrg.gstin ?? ""),
  });
  const [storeState, setStoreState] = React.useState<StoreDraft>({
    name: String(initialStore.name ?? ""),
    address: String(initialStore.address ?? ""),
    city: String(initialStore.city ?? ""),
    region: String(initialStore.region ?? ""),
    postalCode: String(initialStore.postalCode ?? ""),
    phone: String(initialStore.phone ?? ""),
    timezone: String(initialStore.timezone ?? initialOrg.timezone ?? organization.timezone),
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const setOrg = (key: keyof OrganizationDraft, value: string) => setOrgState((current) => ({ ...current, [key]: value }));
  const setStore = (key: keyof StoreDraft, value: string) => setStoreState((current) => ({ ...current, [key]: value }));

  async function saveOrganization() {
    setError("");
    if (orgState.name.trim().length < 2) { setError("Enter your organisation name."); return; }
    if (!orgState.countryCode || !orgState.currency || !orgState.businessType) { setError("Choose your country, currency and business type."); return; }
    if (!["REGISTERED", "NOT_REGISTERED", "UNSURE"].includes(orgState.taxProfileStatus)) { setError("Choose a tax registration status to continue."); return; }
    if (orgState.countryCode === "IN" && orgState.taxProfileStatus === "REGISTERED" && !GSTIN.test(orgState.gstin.trim().toUpperCase())) { setError("Enter a valid 15-character GSTIN."); return; }
    setBusy(true);
    try {
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ version: 2, currentStep: 0, completedSteps: [0], data: { organization: { ...orgState, name: orgState.name.trim(), gstin: orgState.gstin.trim().toUpperCase() } } }) });
      router.push("/onboarding/store");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save organisation details.");
    } finally { setBusy(false); }
  }

  async function saveStore() {
    setError("");
    if (storeState.name.trim().length < 2) { setError("Enter your store name."); return; }
    if (storeState.address.trim().length < 3) { setError("Enter the store street address."); return; }
    if (storeState.city.trim().length < 2) { setError("Enter the store city."); return; }
    setBusy(true);
    try {
      const savedOrg = asRecord(initialData.organization);
      const organizationDraft = Object.keys(savedOrg).length ? savedOrg as OrganizationDraft : orgState;
      const storeDraft = { ...storeState, name: storeState.name.trim(), address: storeState.address.trim(), city: storeState.city.trim() };
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ version: 2, currentStep: 1, completedSteps: [0], data: { store: storeDraft } }) });
      await clientApi("/admin/onboarding/required", { method: "POST", body: JSON.stringify({ organization: organizationDraft, store: storeDraft }) });
      router.replace("/onboarding/optional");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the first store.");
    } finally { setBusy(false); }
  }

  async function skipOptional() {
    setBusy(true);
    setError("");
    try {
      await clientApi("/admin/onboarding/skip-optional", { method: "POST" });
      router.replace("/org");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not continue to the dashboard.");
    } finally { setBusy(false); }
  }

  const field = (label: string, value: string, change: (value: string) => void, props: React.ComponentProps<typeof Input> = {}) => (
    <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span><Input value={value} onChange={(event) => change(event.target.value)} {...props} /></label>
  );

  if (currentStep === 2) return <div className="grid gap-5">
    {complete && <div className="flex items-center gap-2 rounded-md border-l-2 border-l-success bg-success-soft px-3 py-2 text-sm text-success"><CheckCircle2 className="size-4" />Your organisation and first store are ready. These next steps are optional.</div>}
    <Card><CardContent className="grid gap-4 p-4 sm:grid-cols-[8rem_1fr] sm:items-start">
      <p className="text-sm font-semibold">Catalog</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href="/org/catalog/products" className={buttonVariants({ variant: "outline", className: "justify-between" })}>Add your first product <ArrowRight /></Link>
        <Link href="/org/catalog/import" className={buttonVariants({ variant: "outline", className: "justify-between" })}>Import a product CSV <ArrowRight /></Link>
      </div>
      <p className="text-sm font-semibold">Checkout</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href="/org/catalog/tax" className={buttonVariants({ variant: "outline", className: "justify-between" })}>Configure tax groups <ArrowRight /></Link>
        <Link href="/org/settings/billing" className={buttonVariants({ variant: "outline", className: "justify-between" })}>Review payments and receipts <ArrowRight /></Link>
      </div>
      <p className="text-sm font-semibold">Team</p>
      <Link href="/org/users" className={buttonVariants({ variant: "outline", className: "justify-between" })}>Invite staff and assign roles <ArrowRight /></Link>
      <p className="text-sm font-semibold">Devices</p>
      <Link href="/org/stores" className={buttonVariants({ variant: "outline", className: "justify-between" })}>Manage registers and devices <ArrowRight /></Link>
    </CardContent></Card>
    <p className="text-sm text-muted-foreground">You can return to these settings from your dashboard at any time. Adding a product and reviewing tax settings are needed before the corresponding sales can be processed.</p>
    {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void skipOptional()} disabled={busy}>{busy ? "Saving…" : "Skip for now"}</Button><Button onClick={() => void skipOptional()} disabled={busy}>Go to dashboard <ArrowRight /></Button></div>
  </div>;

  if (currentStep === 0) return <div className="grid gap-5">
    <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2">
      {field("Business name", orgState.name, (value) => setOrg("name", value), { autoComplete: "organization" })}
      <label className="grid gap-1.5 text-sm"><span className="font-medium">Country or region</span><NativeSelect value={orgState.countryCode} onChange={(event) => { const market = marketByCode(event.target.value); setOrgState((current) => ({ ...current, countryCode: event.target.value, currency: event.target.value === "ZZ" ? "" : market?.currency ?? current.currency, timezone: market?.timezone ?? current.timezone })); }}>{MARKETS.map((market) => <option key={market.code} value={market.code}>{market.name}</option>)}</NativeSelect></label>
      <label className="grid gap-1.5 text-sm"><span className="font-medium">Base currency</span><NativeSelect value={orgState.currency} onChange={(event) => setOrg("currency", event.target.value)}><option value="">Choose a currency</option>{Object.values(CURRENCIES).map((currency) => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}</NativeSelect><span className="text-xs text-muted-foreground">Suggested from your country. Amounts are recorded in this currency.</span></label>
      <label className="grid gap-1.5 text-sm"><span className="font-medium">Business type</span><NativeSelect value={orgState.businessType} onChange={(event) => setOrg("businessType", event.target.value)}><option value="RETAIL">Retail</option><option value="GROCERY">Grocery</option><option value="PHARMACY">Pharmacy</option><option value="OTHER">Other</option></NativeSelect></label>
      {field("Organisation time zone", orgState.timezone, (value) => setOrg("timezone", value), { placeholder: "Asia/Kolkata" })}
      <label className="grid gap-1.5 text-sm"><span className="font-medium">{orgState.countryCode === "IN" ? "Are you registered for GST?" : "Tax registration"}</span><NativeSelect value={orgState.taxProfileStatus} onChange={(event) => setOrg("taxProfileStatus", event.target.value)}><option value="">Choose one</option><option value="REGISTERED">{orgState.countryCode === "IN" ? "Yes, registered for GST" : "Registered for tax"}</option><option value="NOT_REGISTERED">{orgState.countryCode === "IN" ? "No, not registered" : "Not registered / not applicable"}</option><option value="UNSURE">Not sure yet</option></NativeSelect></label>
      {orgState.countryCode === "IN" && orgState.taxProfileStatus === "REGISTERED" && field("GSTIN", orgState.gstin, (value) => setOrg("gstin", value.toUpperCase()), { autoComplete: "off", maxLength: 15 })}
      <p className="text-xs text-muted-foreground sm:col-span-2">Your sign-in email is {admin.email}. Your choice here does not create tax rates. If you are unsure, setup can finish, but sales stay paused until the tax profile is reviewed.</p>
    </CardContent></Card>
    {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    <div className="flex justify-end"><Button onClick={() => void saveOrganization()} disabled={busy}>{busy ? "Saving…" : "Continue to first store"} <ArrowRight /></Button></div>
  </div>;

  return <div className="grid gap-5">
    <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2">
      {field("Store name", storeState.name, (value) => setStore("name", value), { autoComplete: "organization" })}
      <div className="grid gap-1.5 text-sm"><span className="font-medium">Country</span><p className="rounded-md border bg-muted/30 px-3 py-2">{marketByCode(orgState.countryCode)?.name ?? "Same as organisation"}</p></div>
      <label className="grid gap-1.5 text-sm sm:col-span-2"><span className="font-medium">Street address</span><Textarea value={storeState.address} onChange={(event) => setStore("address", event.target.value)} autoComplete="street-address" /></label>
      {field("City", storeState.city, (value) => setStore("city", value), { autoComplete: "address-level2" })}
      {field("State, province or region", storeState.region, (value) => setStore("region", value), { autoComplete: "address-level1" })}
      {field("Postal code", storeState.postalCode, (value) => setStore("postalCode", value), { autoComplete: "postal-code" })}
      {field("Store phone (optional)", storeState.phone, (value) => setStore("phone", value), { type: "tel", autoComplete: "tel" })}
      {field("Store time zone", storeState.timezone, (value) => setStore("timezone", value), { placeholder: orgState.timezone })}
    </CardContent></Card>
    <p className="text-sm text-muted-foreground">We’ll create a stockroom and a default register automatically. You can add locations, registers, team members and devices later.</p>
    {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    <div className="flex justify-between"><Button variant="outline" onClick={() => router.push("/onboarding/organization")} disabled={busy}>Back</Button><Button onClick={() => void saveStore()} disabled={busy}>{busy ? "Creating store…" : "Create store and continue"} <ArrowRight /></Button></div>
  </div>;
}

"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { clientApi } from "@/features/client-api";
import { CURRENCIES } from "@pos/shared/currency";
import { MARKETS, marketByCode, taxRegimeFor } from "@pos/shared/markets";
import { isOmanCountry, normalizeOmanPhone } from "@pos/shared/address-formats";
import { validateTaxNumber } from "@pos/shared/tax-id";

type OrganizationDraft = {
  name: string;
  address: string;
  countryCode: string;
  taxRegime: string;
  currency: string;
  businessType: string;
  timezone: string;
  taxProfileStatus: string;
  gstin: string;
};
type StoreDraft = { name: string; address: string; city: string; region: string; postalCode: string; phone: string; timezone: string; addressDetails: Record<string, string> };
type Props = {
  currentStep: number;
  initialData: Record<string, unknown>;
  organization: { name: string; maxStores: number; countryCode: string; currency: string; timezone: string; taxProfileStatus: string };
  admin: { email: string };
  complete: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const AUTH_CARD = "rounded-[24px] border-auth-outline bg-auth-surface shadow-sm ring-1 ring-auth-outline";
const AUTH_INPUT = "h-12 rounded-[14px] border-auth-border bg-auth-surface px-4 text-base text-auth-ink placeholder:text-auth-muted focus-visible:border-auth-primary focus-visible:ring-auth-primary/20";
const AUTH_SELECT = "h-12 rounded-[14px] border-auth-border bg-auth-surface px-4 text-base text-auth-ink focus-visible:border-auth-primary focus-visible:ring-3 focus-visible:ring-auth-primary/20";
const AUTH_LABEL = "grid content-start gap-2 text-sm font-medium text-auth-ink";
const AUTH_PRIMARY_BUTTON = "h-12 rounded-[14px] bg-auth-primary px-5 text-base font-bold text-auth-on-primary shadow-sm hover:bg-auth-primary-hover";

export function OnboardingStep({ currentStep, initialData, organization, admin, complete }: Props) {
  const router = useRouter();
  const initialOrg = asRecord(initialData.organization);
  const initialStore = asRecord(initialData.store);
  const [orgState, setOrgState] = React.useState<OrganizationDraft>({
    name: String(initialOrg.name ?? organization.name),
    address: String(initialOrg.address ?? ""),
    countryCode: String(initialOrg.countryCode ?? organization.countryCode),
    taxRegime: String(initialOrg.taxRegime ?? taxRegimeFor(initialOrg.countryCode ?? organization.countryCode)),
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
    addressDetails: {},
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const setOrg = (key: keyof OrganizationDraft, value: string) => setOrgState((current) => ({ ...current, [key]: value }));
  const setStore = (key: Exclude<keyof StoreDraft, "addressDetails">, value: string) => setStoreState((current) => ({ ...current, [key]: value }));
  const vat = orgState.taxRegime === "VAT";

  async function saveOrganization() {
    setError("");
    if (orgState.name.trim().length < 2) { setError("Enter your organisation name."); return; }
    if (!orgState.countryCode || !orgState.currency || !orgState.businessType) { setError("Choose your country, currency and business type."); return; }
    if (!["REGISTERED", "NOT_REGISTERED", "UNSURE"].includes(orgState.taxProfileStatus)) { setError("Choose a tax registration status to continue."); return; }
    if (orgState.taxProfileStatus === "REGISTERED" && (orgState.countryCode === "IN" || orgState.countryCode === "OM")) {
      const check = validateTaxNumber(orgState.countryCode, orgState.gstin.trim().toUpperCase());
      if (!check.valid) { setError(check.error ?? (orgState.countryCode === "OM" ? "Enter a valid Omani VAT number, for example OM1234567890." : "Enter a valid 15-character GSTIN.")); return; }
    }
    setBusy(true);
    try {
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ version: 2, currentStep: 0, completedSteps: [0], data: { organization: { ...orgState, name: orgState.name.trim(), address: "", gstin: orgState.gstin.trim().toUpperCase() } } }) });
      router.push("/onboarding/store");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save organisation details.");
    } finally { setBusy(false); }
  }

  async function saveStore() {
    setError("");
    if (storeState.name.trim().length < 2) { setError("Enter your store name."); return; }
    if (storeState.address.trim().length < 3) { setError("Enter the store address."); return; }
    if (isOmanCountry(orgState.countryCode) && storeState.phone.trim()) {
      const phone = normalizeOmanPhone(storeState.phone);
      if (!phone.valid) { setError(phone.error ?? "Enter a valid Omani phone number."); return; }
    }
    setBusy(true);
    try {
      const savedOrg = asRecord(initialData.organization);
      const organizationDraft = Object.keys(savedOrg).length ? savedOrg as OrganizationDraft : orgState;
      const storeDraft = { ...storeState, name: storeState.name.trim(), address: storeState.address.trim(), city: storeState.city.trim(), region: storeState.region.trim(), postalCode: storeState.postalCode.trim(), addressDetails: {} };
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
    <label className={AUTH_LABEL}><span>{label}</span><Input value={value} onChange={(event) => change(event.target.value)} {...props} className={AUTH_INPUT} /></label>
  );

  if (currentStep === 2) return <div className="grid gap-5 sm:gap-6">
    {complete && <div className="flex items-start gap-3 rounded-[16px] border border-auth-primary/15 bg-auth-primary/[0.045] px-4 py-3.5 text-sm text-auth-ink sm:px-5"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-auth-primary" /><div><p className="font-semibold"><LocalizedText value={"Your organisation and first store are ready."} /></p><p className="mt-0.5 leading-5 text-auth-muted"><LocalizedText value={"Choose an item below, or head to your dashboard and return to these settings later."} /></p></div></div>}
    <Card className={AUTH_CARD}><CardContent className="grid gap-6 p-5 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-7 sm:p-7 lg:p-8">
      <section className="grid content-start gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-auth-primary"><LocalizedText value={"Catalogue"} /></h2>
        <div className="grid gap-2">
          <Link href="/org/catalog/products" className={buttonVariants({ variant: "outline", className: "h-12 justify-between rounded-[14px] border-auth-border bg-auth-surface px-4 text-start font-medium text-auth-ink hover:border-auth-primary hover:bg-auth-surface" })}><LocalizedText value={"Add your first product "} /><ArrowRight className="rtl:rotate-180" /></Link>
          <Link href="/org/catalog/import" className={buttonVariants({ variant: "outline", className: "h-12 justify-between rounded-[14px] border-auth-border bg-auth-surface px-4 text-start font-medium text-auth-ink hover:border-auth-primary hover:bg-auth-surface" })}><LocalizedText value={"Import a product CSV "} /><ArrowRight className="rtl:rotate-180" /></Link>
        </div>
      </section>
      <section className="grid content-start gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-auth-primary"><LocalizedText value={"Checkout"} /></h2>
        <div className="grid gap-2">
          <Link href="/org/settings/billing" className={buttonVariants({ variant: "outline", className: "h-12 justify-between rounded-[14px] border-auth-border bg-auth-surface px-4 text-start font-medium text-auth-ink hover:border-auth-primary hover:bg-auth-surface" })}><LocalizedText value={"Review payments and receipts "} /><ArrowRight className="rtl:rotate-180" /></Link>
        </div>
      </section>
      <section className="grid content-start gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-auth-primary"><LocalizedText value={"People"} /></h2>
        <Link href="/org/users" className={buttonVariants({ variant: "outline", className: "h-12 justify-between rounded-[14px] border-auth-border bg-auth-surface px-4 text-start font-medium text-auth-ink hover:border-auth-primary hover:bg-auth-surface" })}><LocalizedText value={"Invite staff and assign roles "} /><ArrowRight className="rtl:rotate-180" /></Link>
      </section>
      <section className="grid content-start gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-auth-primary"><LocalizedText value={"Devices"} /></h2>
        <Link href="/org/stores" className={buttonVariants({ variant: "outline", className: "h-12 justify-between rounded-[14px] border-auth-border bg-auth-surface px-4 text-start font-medium text-auth-ink hover:border-auth-primary hover:bg-auth-surface" })}><LocalizedText value={"Manage registers and devices "} /><ArrowRight className="rtl:rotate-180" /></Link>
      </section>
    </CardContent></Card>
    <p className="text-sm leading-6 text-auth-muted"><LocalizedText value={"These settings are available from your dashboard whenever you need them. Configure products and tax groups before processing those sales."} /></p>
    {error && <p role="alert" className="rounded-[14px] border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
    <div className="flex justify-end"><Button className={AUTH_PRIMARY_BUTTON} onClick={() => void skipOptional()} disabled={busy}><LocalizedText value={busy ? "Saving…" : "Go to dashboard"} /> <ArrowRight className="rtl:rotate-180" /></Button></div>
  </div>;

  if (currentStep === 0) return <div className="grid gap-5 sm:gap-6">
    <Card className={AUTH_CARD}><CardContent className="grid gap-x-5 gap-y-5 p-5 sm:grid-cols-2 sm:p-7 lg:p-8">
      {field("Business name", orgState.name, (value) => setOrg("name", value), { autoComplete: "organization" })}
      <label className={AUTH_LABEL}><span><LocalizedText value={"Country or region"} /></span><NativeSelect className={AUTH_SELECT} value={orgState.countryCode} onChange={(event) => { const market = marketByCode(event.target.value); setOrgState((current) => ({ ...current, countryCode: event.target.value, currency: market?.currency ?? current.currency, timezone: market?.timezone ?? current.timezone, taxRegime: taxRegimeFor(event.target.value), gstin: "" })); }}>{MARKETS.map((market) => <option key={market.code} value={market.code}>{market.name}</option>)}</NativeSelect></label>
      <label className={AUTH_LABEL}><span><LocalizedText value={"Base currency"} /></span><NativeSelect className={AUTH_SELECT} value={orgState.currency} onChange={(event) => setOrg("currency", event.target.value)}><option value=""><LocalizedText value={"Choose a currency"} /></option>{Object.values(CURRENCIES).map((currency) => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}</NativeSelect><span className="text-xs font-normal leading-5 text-auth-muted"><LocalizedText value={"Suggested from your country. Amounts are recorded in this currency."} /></span></label>
      <label className={AUTH_LABEL}><span><LocalizedText value={"Tax wording"} /></span><NativeSelect className={AUTH_SELECT} value={orgState.taxRegime} onChange={(event) => setOrg("taxRegime", event.target.value)}><option value="VAT"><LocalizedText value={"VAT"} /></option><option value="GST"><LocalizedText value={"GST"} /></option><option value="TAX"><LocalizedText value={"Tax"} /></option></NativeSelect></label>
      <label className={AUTH_LABEL}><span><LocalizedText value={"Business type"} /></span><NativeSelect className={AUTH_SELECT} value={orgState.businessType} onChange={(event) => setOrg("businessType", event.target.value)}><option value="RETAIL"><LocalizedText value={"Retail"} /></option><option value="GROCERY"><LocalizedText value={"Grocery"} /></option><option value="PHARMACY"><LocalizedText value={"Pharmacy"} /></option><option value="OTHER"><LocalizedText value={"Other"} /></option></NativeSelect></label>
      {field("Organisation time zone", orgState.timezone, (value) => setOrg("timezone", value), { placeholder: "Asia/Muscat" })}
      <label className={AUTH_LABEL}><span><LocalizedText value={orgState.countryCode === "IN" ? "Are you registered for GST?" : vat ? "Are you registered for VAT?" : "Tax registration"} /></span><NativeSelect className={AUTH_SELECT} value={orgState.taxProfileStatus} onChange={(event) => setOrg("taxProfileStatus", event.target.value)}><option value=""><LocalizedText value={"Choose one"} /></option><option value="REGISTERED"><LocalizedText value={orgState.countryCode === "IN" ? "Yes, registered for GST" : vat ? "Yes, registered for VAT" : "Registered for tax"} /></option><option value="NOT_REGISTERED"><LocalizedText value={orgState.countryCode === "IN" ? "No, not registered" : "Not registered / not applicable"} /></option><option value="UNSURE"><LocalizedText value={"Not sure yet"} /></option></NativeSelect></label>
      {orgState.countryCode === "IN" && orgState.taxProfileStatus === "REGISTERED" && field("GSTIN", orgState.gstin, (value) => setOrg("gstin", value.toUpperCase()), { autoComplete: "off", maxLength: 15 })}
      {orgState.countryCode === "OM" && orgState.taxProfileStatus === "REGISTERED" && field("VAT number", orgState.gstin, (value) => setOrg("gstin", value.toUpperCase()), { autoComplete: "off", maxLength: 12, placeholder: "OM1234567890" })}
      {orgState.countryCode !== "OM" && orgState.countryCode !== "IN" && orgState.taxProfileStatus === "REGISTERED" && field("Tax number", orgState.gstin, (value) => setOrg("gstin", value.toUpperCase()), { autoComplete: "off", maxLength: 20 })}
      <div className="flex gap-3 rounded-[14px] bg-auth-canvas px-4 py-3 text-sm leading-5 text-auth-muted sm:col-span-2"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-auth-primary" /><p><span className="font-semibold text-auth-ink"><LocalizedText value={"Signed in as "} />{admin.email}.</span> <LocalizedText value={"Tax status is recorded here; tax rates are configured separately."} /></p></div>
    </CardContent></Card>
    {error && <p role="alert" className="rounded-[14px] border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
    <div className="flex justify-end"><Button className={AUTH_PRIMARY_BUTTON} onClick={() => void saveOrganization()} disabled={busy}><LocalizedText value={busy ? "Saving…" : "Continue to first store"} /> <ArrowRight className="rtl:rotate-180" /></Button></div>
  </div>;

  return <div className="grid gap-5 sm:gap-6">
    <Card className={AUTH_CARD}><CardContent className="grid gap-x-5 gap-y-5 p-5 sm:grid-cols-2 sm:p-7 lg:p-8">
      {field("Store name", storeState.name, (value) => setStore("name", value), { autoComplete: "organization" })}
      <div className={AUTH_LABEL}><span><LocalizedText value={"Country"} /></span><p className="flex h-12 items-center rounded-[14px] border border-auth-border bg-auth-canvas px-4 text-base font-normal text-auth-muted">{marketByCode(orgState.countryCode)?.name ?? "Same as organisation"}</p></div>
      {field("Address", storeState.address, (value) => setStore("address", value), { autoComplete: "street-address" })}
      {field("City / town", storeState.city, (value) => setStore("city", value), { autoComplete: "address-level-2" })}
      {field("State / region", storeState.region, (value) => setStore("region", value), { autoComplete: "address-level-1" })}
      {field("Postal code", storeState.postalCode, (value) => setStore("postalCode", value), { autoComplete: "postal-code" })}
      {field("Store phone", storeState.phone, (value) => setStore("phone", value), { type: "tel", autoComplete: "tel", placeholder: isOmanCountry(orgState.countryCode) ? "+968 9123 4567" : "" })}
      {field("Store time zone", storeState.timezone, (value) => setStore("timezone", value), { placeholder: orgState.timezone })}
    </CardContent></Card>
    <p className="text-sm leading-6 text-auth-muted"><LocalizedText value={"A stockroom and a default register are created with your first store. You can add locations, registers, team members and devices from your workspace."} /></p>
    {error && <p role="alert" className="rounded-[14px] border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Button variant="outline" className="h-12 rounded-[14px] border-auth-border bg-auth-surface px-5 text-base font-semibold text-auth-ink hover:bg-auth-canvas" onClick={() => router.push("/onboarding/organization")} disabled={busy}><LocalizedText value={"Back"} /></Button><Button className={AUTH_PRIMARY_BUTTON} onClick={() => void saveStore()} disabled={busy}><LocalizedText value={busy ? "Creating store…" : "Create store and continue"} /> <ArrowRight className="rtl:rotate-180" /></Button></div>
  </div>;
}

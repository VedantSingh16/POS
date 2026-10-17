"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import { EMPTY_STORE_HOURS, STORE_DAYS, cloneStoreHours, type StoreOperatingHours } from "@pos/shared/store-hours";

type StoreProfile = { id: string; code: string; name: string; address: string; city?: string; region?: string; postalCode?: string; countryCode?: string; taxRegime?: string; phone?: string; timezone: string; operatingHours: StoreOperatingHours | null; taxNumber?: string };
const dayLabels: Record<(typeof STORE_DAYS)[number], string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };

export function StoreSettingsForm({ initial, canEdit = true }: { initial: StoreProfile; canEdit?: boolean }) {
  const [values, setValues] = React.useState({ name: initial.name, address: initial.address, city: initial.city ?? "", region: initial.region ?? "", postalCode: initial.postalCode ?? "", phone: initial.phone ?? "", timezone: initial.timezone, taxNumber: initial.taxNumber ?? "" });
  const [hoursEnabled, setHoursEnabled] = React.useState(Boolean(initial.operatingHours && Object.keys(initial.operatingHours).length));
  const [hours, setHours] = React.useState<StoreOperatingHours>(() => initial.operatingHours ? cloneStoreHours(initial.operatingHours) : cloneStoreHours(EMPTY_STORE_HOURS));
  const [busy, setBusy] = React.useState(false);
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function save() {
    if (values.address.trim().length < 2) { toast.error("Enter the store address"); return; }
    setBusy(true);
    try {
      await clientApi(`/admin/stores/${initial.id}/settings`, { method: "PATCH", body: JSON.stringify({ ...values, address: values.address.trim(), operatingHours: hoursEnabled ? hours : null }) });
      toast.success("Store settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save store settings");
    } finally { setBusy(false); }
  }

  function setDay(day: (typeof STORE_DAYS)[number], enabled: boolean, key: "open" | "close", value: string) {
    setHours((current) => ({ ...current, [day]: enabled ? { ...(current[day] ?? { open: "09:00", close: "18:00" }), [key]: value } : null }));
  }

  return <div className="grid gap-4">
    {!canEdit && <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"><LocalizedText value={"Read-only store view. Store-scoped staff can change these settings."} /></p>}
    <div className="grid gap-4 sm:max-w-2xl">
      <label className="grid gap-1 text-sm"><LocalizedText value={"Store code"} /><Input value={initial.code} disabled /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Store name"} /><Input value={values.name} disabled={!canEdit} onChange={(event) => set("name", event.target.value)} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Store address"} /><Input value={values.address} disabled={!canEdit} onChange={(event) => set("address", event.target.value)} autoComplete="street-address" /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"City / town"} /><Input value={values.city} disabled={!canEdit} onChange={(event) => set("city", event.target.value)} autoComplete="address-level-2" /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"State / region"} /><Input value={values.region} disabled={!canEdit} onChange={(event) => set("region", event.target.value)} autoComplete="address-level-1" /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Postal code"} /><Input value={values.postalCode} disabled={!canEdit} onChange={(event) => set("postalCode", event.target.value)} autoComplete="postal-code" /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Store phone"} /><Input type="tel" value={values.phone} disabled={!canEdit} onChange={(event) => set("phone", event.target.value)} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Time zone"} /><Input value={values.timezone} disabled={!canEdit} onChange={(event) => set("timezone", event.target.value)} placeholder="Asia/Muscat" /></label>
      <section className="grid gap-3 rounded-lg border p-4">
        <div><h2 className="font-semibold"><LocalizedText value={"Store operating hours"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={"Registers can be opened only during these hours."} /></p></div>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={hoursEnabled} disabled={!canEdit} onChange={(event) => setHoursEnabled(event.target.checked)} /><LocalizedText value={"Restrict register opening to these hours"} /></label>
        {hoursEnabled && <div className="grid gap-2">{STORE_DAYS.map((day) => { const entry = hours[day]; return <div className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_1fr]" key={day}>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(entry)} disabled={!canEdit} onChange={(event) => setDay(day, event.target.checked, "open", entry?.open ?? "09:00")} /><span>{dayLabels[day]}</span></label>
          <Input type="time" value={entry?.open ?? "09:00"} disabled={!canEdit || !entry} onChange={(event) => setDay(day, true, "open", event.target.value)} aria-label={`${dayLabels[day]} opening time`} />
          <Input type="time" value={entry?.close ?? "18:00"} disabled={!canEdit || !entry} onChange={(event) => setDay(day, true, "close", event.target.value)} aria-label={`${dayLabels[day]} closing time`} />
        </div>; })}</div>}
      </section>
      <label className="grid gap-1 text-sm"><LocalizedText value={initial.taxRegime === "GST" ? "Store GSTIN" : initial.taxRegime === "VAT" ? "Store VAT number" : "Store tax number"} /><Input value={values.taxNumber} disabled={!canEdit} onChange={(event) => set("taxNumber", event.target.value.toUpperCase())} maxLength={initial.countryCode === "IN" ? 15 : initial.countryCode === "OM" ? 12 : 20} placeholder="Use the organisation's tax number" /></label>
      <p className="text-xs text-muted-foreground"><LocalizedText value={"Printed on this store's invoices as the seller. Leave blank to use the organisation's tax number."} /></p>
      {canEdit && <Button className="sm:w-fit" onClick={() => void save()} disabled={busy}><LocalizedText value={busy ? "Saving…" : "Save store settings"} /></Button>}
    </div>
  </div>;
}

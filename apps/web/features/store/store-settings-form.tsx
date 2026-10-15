"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";

type StoreProfile = { id: string; code: string; name: string; address: string; city?: string; region?: string; postalCode?: string; phone?: string; timezone: string; closeHour: number | null; taxNumber?: string };

export function StoreSettingsForm({ initial, canEdit = true }: { initial: StoreProfile; canEdit?: boolean }) {
  const [values, setValues] = React.useState({ name: initial.name, address: initial.address, city: initial.city ?? "", region: initial.region ?? "", postalCode: initial.postalCode ?? "", phone: initial.phone ?? "", timezone: initial.timezone, taxNumber: initial.taxNumber ?? "", closeHour: initial.closeHour === null ? "" : String(initial.closeHour) });
  const [busy, setBusy] = React.useState(false);
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    try {
      await clientApi(`/admin/stores/${initial.id}/settings`, { method: "PATCH", body: JSON.stringify({ ...values, closeHour: values.closeHour === "" ? null : Number(values.closeHour) }) });
      toast.success("Store profile saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save store profile");
    } finally { setBusy(false); }
  }

  return <div className="grid gap-4">
    {!canEdit && <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"><LocalizedText value={"Read-only store view. Store-scoped staff can change these settings."} /></p>}
    <div className="grid gap-4 sm:max-w-xl">
      <label className="grid gap-1 text-sm"><LocalizedText value={"Store code"} /><Input value={initial.code} disabled /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Store name"} /><Input value={values.name} disabled={!canEdit} onChange={(event) => set("name", event.target.value)} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Address"} /><Input value={values.address} disabled={!canEdit} onChange={(event) => set("address", event.target.value)} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"City"} /><Input value={values.city} disabled={!canEdit} onChange={(event) => set("city", event.target.value)} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"State, province or region"} /><Input value={values.region} disabled={!canEdit} onChange={(event) => set("region", event.target.value)} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Postal code"} /><Input value={values.postalCode} disabled={!canEdit} onChange={(event) => set("postalCode", event.target.value)} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Store phone"} /><Input type="tel" value={values.phone} disabled={!canEdit} onChange={(event) => set("phone", event.target.value)} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Store GSTIN"} /><Input value={values.taxNumber} disabled={!canEdit} onChange={(event) => set("taxNumber", event.target.value.toUpperCase())} maxLength={15} placeholder="Use the organisation's GSTIN" /></label>
      <p className="text-xs text-muted-foreground"><LocalizedText value={"Printed on this store's invoices as the seller. Its state decides CGST/SGST or IGST for business buyers. Leave blank to use the organisation's GSTIN."} /></p>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Time zone"} /><Input value={values.timezone} disabled={!canEdit} onChange={(event) => set("timezone", event.target.value)} placeholder="Asia/Kolkata" /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Business close hour"} /><Input type="number" min="0" max="23" value={values.closeHour} disabled={!canEdit} onChange={(event) => set("closeHour", event.target.value)} placeholder="Use default" /></label>
      <p className="text-xs text-muted-foreground"><LocalizedText value={"Enter a 24-hour clock hour from 0 to 23. Leave blank to use the organisation default."} /></p>
      {canEdit && <Button className="sm:w-fit" onClick={() => void save()} disabled={busy}><LocalizedText value={busy ? "Saving…" : "Save store profile"} /></Button>}
    </div>
  </div>;
}

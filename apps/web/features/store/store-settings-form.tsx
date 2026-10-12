"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";

type StoreSettings = { id: string; code: string; name: string; address: string; timezone: string; closeHour: number | null };
export function StoreSettingsForm({ initial }: { initial: StoreSettings }) {
  const [values, setValues] = React.useState({ name: initial.name, address: initial.address, timezone: initial.timezone, closeHour: initial.closeHour === null ? "" : String(initial.closeHour) });
  const [busy, setBusy] = React.useState(false);
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  async function save() {
    setBusy(true);
    try {
      await clientApi(`/admin/stores/${initial.id}/settings`, { method: "PATCH", body: JSON.stringify({ ...values, closeHour: values.closeHour === "" ? null : Number(values.closeHour) }) });
      toast.success("Store settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save store settings");
    } finally { setBusy(false); }
  }
  return <div className="grid gap-4 sm:max-w-xl">
    <label className="grid gap-1 text-sm">Store code<Input value={initial.code} disabled /></label>
    <label className="grid gap-1 text-sm">Store name<Input value={values.name} onChange={(event) => set("name", event.target.value)} /></label>
    <label className="grid gap-1 text-sm">Address<Input value={values.address} onChange={(event) => set("address", event.target.value)} /></label>
    <label className="grid gap-1 text-sm">Time zone<Input value={values.timezone} onChange={(event) => set("timezone", event.target.value)} placeholder="Asia/Kolkata" /></label>
    <label className="grid gap-1 text-sm">Business close hour<Input type="number" min="0" max="23" value={values.closeHour} onChange={(event) => set("closeHour", event.target.value)} placeholder="Use default" /></label>
    <p className="text-xs text-muted-foreground">Enter a 24-hour clock hour from 0 to 23. Leave blank to use the organisation default.</p>
    <Button className="sm:w-fit" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save store settings"}</Button>
  </div>;
}

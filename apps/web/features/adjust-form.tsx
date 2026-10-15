"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { ConfirmDialog } from "@/components/form/dialogs";
import { clientApi } from "@/features/client-api";

const schema = z.object({
  sku: z.string().trim().min(1, "Enter a SKU"),
  quantity: z.coerce.number().int("Whole units only").refine((n) => n !== 0, "Quantity cannot be zero"),
  reason: z.enum(["DAMAGE", "COUNT", "RECEIPT", "OTHER"]),
});
type In = z.input<typeof schema>;
type Out = z.output<typeof schema>;

type Item = { id: string; sku: string; name: string };
type Location = { id: string; name: string; storeId: string | null };

export function AdjustStockForm({ items, locations, storeId }: { items: Item[]; locations: Location[]; storeId: string }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm<In, unknown, Out>({ resolver: zodResolver(schema), defaultValues: { sku: "", quantity: 0, reason: "COUNT" } });
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const onValid = async (values: Out) => {
    const item = items.find((candidate) => candidate.sku.toLowerCase() === values.sku.toLowerCase());
    const location = locations.find((candidate) => candidate.storeId === storeId) ?? locations[0];
    if (!item || !location) { setError(!item ? "Choose an existing SKU." : "No stock location exists for this store."); return; }
    setError(""); setBusy(true);
    try {
      await clientApi("/pos/v1/inventory/adjustments", { method: "POST", body: JSON.stringify({ storeId, locationId: location.id, variantId: item.id, quantity: values.quantity, reason: values.reason }) });
      toast.success("Stock adjustment recorded"); reset();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save adjustment"); }
    finally { setBusy(false); }
  };
  return (
    <Card className="max-w-xl"><CardContent>
      <form className="grid gap-4" onSubmit={handleSubmit(onValid)} noValidate>
        <Field label="SKU" htmlFor="a-sku" error={errors.sku?.message}><NativeSelect id="a-sku" {...register("sku")}><option value=""><LocalizedText value={"Choose SKU…"} /></option>{items.map((item) => <option key={item.id} value={item.sku}>{item.sku} — {item.name}</option>)}</NativeSelect></Field>
        <Field label="Quantity change" htmlFor="a-qty" hint="Use a negative number to remove stock." error={errors.quantity?.message}><Input id="a-qty" type="number" {...register("quantity")} /></Field>
        <Field label="Reason" htmlFor="a-reason"><NativeSelect id="a-reason" {...register("reason")}><option value="COUNT"><LocalizedText value={"Stock count"} /></option><option value="DAMAGE"><LocalizedText value={"Damage"} /></option><option value="RECEIPT"><LocalizedText value={"Goods received"} /></option><option value="OTHER"><LocalizedText value={"Other"} /></option></NativeSelect></Field>
        <div className="flex justify-end gap-2">
          <ConfirmDialog trigger={<Button type="button" variant="outline"><LocalizedText value={"Clear"} /></Button>} title="Clear the form?" description="Entered values will be discarded." confirmLabel="Clear" destructive onConfirm={() => reset()} />
          <Button type="submit" disabled={busy}><LocalizedText value={busy ? "Saving…" : "Record adjustment"} /></Button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </CardContent></Card>
  );
}

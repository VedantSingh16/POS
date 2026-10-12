"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetClose } from "@/components/ui/sheet";
import { Field } from "@/components/form/field";
import { ConfirmDialog, FormSheet } from "@/components/form/dialogs";
import { clientApi } from "@/features/client-api";

/** Activate or deactivate a store. Deactivated stores stop counting toward the organisation's store limit. */
export function StoreStatusButton({ storeId, storeName, status }: { storeId: string; storeName: string; status: string }) {
  const router = useRouter();
  const active = status === "ACTIVE";
  async function change() {
    try {
      await clientApi(`/admin/stores/${storeId}`, { method: "PATCH", body: JSON.stringify({ status: active ? "INACTIVE" : "ACTIVE" }) });
      toast.success(active ? `${storeName} deactivated` : `${storeName} activated`);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not change the store status"); }
  }
  return (
    <ConfirmDialog
      trigger={<Button variant="outline"><Power /> {active ? "Deactivate" : "Activate"}</Button>}
      title={active ? `Deactivate ${storeName}?` : `Activate ${storeName}?`}
      description={active ? "A deactivated store no longer counts toward your store limit. Its sales, stock history and staff records are kept, and you can activate it again at any time." : "The store will count toward your store limit again. This fails if the limit has been reached."}
      confirmLabel={active ? "Deactivate store" : "Activate store"}
      destructive={active}
      onConfirm={() => void change()}
    />
  );
}

export function AddRegisterSheet({ storeId, existing }: { storeId: string; existing: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState(`REG-${String(existing + 1).padStart(2, "0")}`);
  const [name, setName] = React.useState(existing === 0 ? "Front Till" : `Till ${existing + 1}`);
  const [busy, setBusy] = React.useState(false);
  async function save() {
    if (!code.trim() || !name.trim()) { toast.error("Enter a register code and name"); return; }
    setBusy(true);
    try {
      await clientApi(`/admin/stores/${storeId}/registers`, { method: "POST", body: JSON.stringify({ code: code.trim(), name: name.trim() }) });
      toast.success("Register added");
      setOpen(false);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not add the register"); }
    finally { setBusy(false); }
  }
  return (
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> Add register</Button>} title="Add register" description="A register is a till. Cashiers open a session on it with an opening float.">
      <div className="grid gap-4">
        <Field label="Register code" htmlFor="r-code" hint="Unique within this store."><Input id="r-code" value={code} onChange={(event) => setCode(event.target.value)} /></Field>
        <Field label="Register name" htmlFor="r-name"><Input id="r-name" value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button onClick={() => void save()} disabled={busy}>{busy ? "Adding…" : "Add register"}</Button></div>
      </div>
    </FormSheet>
  );
}

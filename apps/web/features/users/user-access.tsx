"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { SheetClose } from "@/components/ui/sheet";
import { Field } from "@/components/form/field";
import { FormSheet } from "@/components/form/dialogs";
import { clientApi } from "@/features/client-api";

type Assignment = { id: string; name: string; scopeType: string; scopeId: string | null };
type Props = {
  userId: string;
  userName: string;
  current: Assignment[];
  roles: { id: string; name: string; system: boolean }[];
  stores: { id: string; name: string }[];
};

/**
 * Change which role someone holds and where. Built-in store roles must be tied to one store; only the organisation
 * administrator role (or a custom role, on purpose) can apply to every store.
 */
export function UserAccessSheet({ userId, userName, current, roles, stores }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const first = current[0];
  const [roleId, setRoleId] = React.useState(first?.id ?? "");
  const [storeId, setStoreId] = React.useState(first?.scopeType === "STORE" ? first.scopeId ?? "" : "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const role = roles.find((r) => r.id === roleId);
  const orgAdmin = role?.name === "Organisation Administrator";
  const canBeOrgWide = role !== undefined && (orgAdmin || role.system === false);
  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.name ?? "A store";

  async function save() {
    setError("");
    if (!role) { setError("Choose a role."); return; }
    const orgWide = canBeOrgWide && !storeId;
    if (!orgWide && !storeId) { setError("This role works inside one store. Choose which store."); return; }
    setBusy(true);
    try {
      await clientApi(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ storeIds: orgWide ? [] : [storeId], roleAssignments: [{ roleId: role.id, scopeType: orgWide ? "ORGANIZATION" : "STORE", storeId: orgWide ? null : storeId }] }) });
      toast.success("Access updated");
      setOpen(false);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update access"); }
    finally { setBusy(false); }
  }

  return (
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button variant="outline"><ShieldCheck /> Edit access</Button>} title={`Access for ${userName}`} description="Choose the role this person holds and where they can use it. Saving replaces their current access.">
      <div className="grid gap-4">
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Current access</p>
          {current.length ? <ul>{current.map((a) => <li key={`${a.id}-${a.scopeId}`}>{a.name} · {a.scopeType === "STORE" ? storeName(a.scopeId) : "Organisation-wide"}</li>)}</ul> : <p>None</p>}
          {current.length > 1 && <p className="mt-1 text-xs text-warning">This person holds several assignments; saving keeps only the one you choose below.</p>}
        </div>
        <Field label="Role" htmlFor="ua-role">
          <NativeSelect id="ua-role" value={roleId} onChange={(event) => { setRoleId(event.target.value); setError(""); }}>
            <option value="">Select a role…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </NativeSelect>
        </Field>
        {orgAdmin ? (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Organisation administrators can see and change every store, user and setting.</p>
        ) : (
          <Field label={canBeOrgWide ? "Store (leave empty for all stores)" : "Store"} htmlFor="ua-store">
            <NativeSelect id="ua-store" value={storeId} onChange={(event) => { setStoreId(event.target.value); setError(""); }}>
              <option value="">{canBeOrgWide ? "All stores (organisation-wide)" : "Select a store…"}</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save access"}</Button></div>
      </div>
    </FormSheet>
  );
}

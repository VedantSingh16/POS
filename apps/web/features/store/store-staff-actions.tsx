"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { LocalizedText } from "@/components/i18n/localized-text";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, PasswordInput } from "@/components/ui/input";
import { SheetClose } from "@/components/ui/sheet";
import { Field } from "@/components/form/field";
import { ConfirmDialog, FormSheet } from "@/components/form/dialogs";
import { clientApi } from "@/features/client-api";
import { toast } from "@/lib/i18n/toast";

const staffSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  roleId: z.string().min(1, "Choose a role"),
  password: z.string().min(12, "Use at least 12 characters"),
});
type StaffInput = z.input<typeof staffSchema>;

/** Store managers add people who can only work in this store, with a role the manager is allowed to assign. */
export function StoreStaffInviteSheet({ storeId, storeName, roles }: { storeId: string; storeName: string; roles: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const empty = { name: "", email: "", roleId: "", password: "" };
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<StaffInput>({ resolver: zodResolver(staffSchema), defaultValues: empty });

  async function submit(value: StaffInput) {
    try {
      const [firstName, ...rest] = value.name.trim().split(/\s+/);
      await clientApi(`/admin/stores/${storeId}/users`, { method: "POST", body: JSON.stringify({ firstName, lastName: rest.join(" "), email: value.email, password: value.password, roleId: value.roleId }) });
      toast.success("Staff member added to this store");
      reset(empty); setOpen(false); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not add the staff member"); }
  }

  return (
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button disabled={roles.length === 0} title={roles.length === 0 ? "No roles are approved for store assignment" : undefined}><Plus /> <LocalizedText value={"Add staff member"} /></Button>} title="Add staff member" description="This person will only be able to work in this store.">
      <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
        <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground"><LocalizedText value={"Store: "} /><strong>{storeName}</strong></p>
        <Field label="Full name" htmlFor="ss-name" error={errors.name?.message}><Input id="ss-name" aria-invalid={!!errors.name} {...register("name")} /></Field>
        <Field label="Email" htmlFor="ss-email" error={errors.email?.message} hint="Used to sign in. Stored in lowercase."><Input id="ss-email" type="email" aria-invalid={!!errors.email} {...register("email")} /></Field>
        <Field label="Store role" htmlFor="ss-role" error={errors.roleId?.message}>
          <NativeSelect id="ss-role" aria-invalid={!!errors.roleId} {...register("roleId")}>
            <option value=""><LocalizedText value={"Select a role…"} /></option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Temporary password" htmlFor="ss-password" error={errors.password?.message} hint="At least 12 characters. Share it securely."><PasswordInput id="ss-password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <SheetClose asChild><Button type="button" variant="outline"><LocalizedText value={"Cancel"} /></Button></SheetClose>
          <Button type="submit" disabled={isSubmitting}><LocalizedText value={isSubmitting ? "Adding…" : "Add staff member"} /></Button>
        </div>
      </form>
    </FormSheet>
  );
}

/** Disable/enable and reset the password of someone who only works in this store. */
export function StoreStaffAccountActions({ storeId, userId, name, status }: { storeId: string; userId: string; name: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const active = status === "ACTIVE";

  async function update(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      await clientApi(`/admin/stores/${storeId}/users/${userId}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(success);
      router.refresh();
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update the staff member"); return false; }
    finally { setBusy(false); }
  }

  return <div className="flex min-w-44 flex-wrap items-center gap-2">
    <ConfirmDialog destructive={active} confirmLabel={active ? "Deactivate" : "Reactivate"} title={`${active ? "Deactivate" : "Reactivate"} ${name}?`} description={active ? "They will be signed out and cannot sign in until reactivated. Their history is kept." : "They will be able to sign in again with their current password."} onConfirm={() => void update({ status: active ? "DISABLED" : "ACTIVE" }, active ? "Staff member deactivated" : "Staff member reactivated")} trigger={<Button size="sm" variant="outline" disabled={busy}><LocalizedText value={active ? "Deactivate" : "Reactivate"} /></Button>} />
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button size="sm" variant="outline" disabled={busy}><LocalizedText value={"Reset password"} /></Button>} title={`Reset password for ${name}`} description="Set a new password and tell them securely. It also clears any sign-in lockout.">
      <form className="grid gap-4 pb-6" onSubmit={async (event) => { event.preventDefault(); if (password.length < 12) { toast.error("The password must be at least 12 characters."); return; } if (await update({ password }, "Password reset")) { setOpen(false); setPassword(""); } }}>
        <Field label="New password" htmlFor={`reset-${userId}`} hint="At least 12 characters."><PasswordInput id={`reset-${userId}`} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        <div className="flex justify-end gap-2"><SheetClose asChild><Button type="button" variant="outline"><LocalizedText value={"Cancel"} /></Button></SheetClose><Button type="submit" disabled={busy}><LocalizedText value={busy ? "Saving…" : "Reset password"} /></Button></div>
      </form>
    </FormSheet>
  </div>;
}

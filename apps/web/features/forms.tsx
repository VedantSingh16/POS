"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormSheet } from "@/components/form/dialogs";
import { SheetClose } from "@/components/ui/sheet";
import { clientApi } from "@/features/client-api";

const userSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  role: z.string().min(1, "Choose a role"),
  storeId: z.string().optional(),
  password: z.string().min(12, "Use at least 12 characters"),
});
type UserInput = z.input<typeof userSchema>;
type RoleOption = { id: string; name: string; system?: boolean };

/** Only the organisation administrator role is organisation-wide by nature. Built-in store roles must always be tied to a store. */
const isOrgAdminRole = (role?: RoleOption) => role?.name === "Organisation Administrator";

export function InviteUserSheet({ roles, stores = [], fixedStore }: { roles: RoleOption[]; stores?: { id: string; name: string }[]; fixedStore?: { id: string; name: string } }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const { register, handleSubmit, reset, watch, setError, formState: { errors, isSubmitting } } = useForm<UserInput>({ resolver: zodResolver(userSchema), defaultValues: { name: "", email: "", role: "", storeId: fixedStore?.id ?? "", password: "" } });
  const selectedRole = roles.find((role) => role.id === watch("role"));
  const orgAdmin = isOrgAdminRole(selectedRole);
  // Custom roles may be granted organisation-wide on purpose; built-in store roles may not.
  const canBeOrgWide = !fixedStore && selectedRole !== undefined && (orgAdmin || selectedRole.system === false);
  const availableRoles = fixedStore ? roles.filter((role) => !isOrgAdminRole(role)) : roles;

  async function submit(value: UserInput) {
    const orgWide = canBeOrgWide && !value.storeId;
    if (!orgWide && !value.storeId) { setError("storeId", { message: "Choose the store this person works at" }); return; }
    try {
      const [firstName, ...rest] = value.name.trim().split(/\s+/);
      await clientApi("/admin/users", { method: "POST", body: JSON.stringify({ firstName, lastName: rest.join(" "), email: value.email, password: value.password, storeIds: orgWide ? [] : [value.storeId], roleAssignments: [{ roleId: value.role, scopeType: orgWide ? "ORGANIZATION" : "STORE", storeId: orgWide ? null : value.storeId }] }) });
      toast.success(orgWide ? "User created with organisation-wide access" : "User created and assigned to the store");
      reset({ name: "", email: "", role: "", storeId: fixedStore?.id ?? "", password: "" });
      setOpen(false);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create user"); }
  }

  return (
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button><Plus /> Add team member</Button>} title={fixedStore ? `Add to ${fixedStore.name}` : "Add team member"} description={fixedStore ? "This person will only be able to work in this store." : "Pick a role first; it decides whether the person works in one store or across the organisation."}>
      <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
        <Field label="Full name" htmlFor="u-name" error={errors.name?.message}><Input id="u-name" aria-invalid={!!errors.name} {...register("name")} /></Field>
        <Field label="Email" htmlFor="u-email" error={errors.email?.message} hint="Used to sign in. Stored in lowercase."><Input id="u-email" type="email" aria-invalid={!!errors.email} {...register("email")} /></Field>
        <Field label="Role" htmlFor="u-role" error={errors.role?.message}>
          <NativeSelect id="u-role" aria-invalid={!!errors.role} {...register("role")}>
            <option value="">Select a role…</option>
            {availableRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </NativeSelect>
        </Field>
        {orgAdmin ? (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Organisation administrators can see and change every store, user and setting in the organisation.</p>
        ) : fixedStore ? (
          <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">Store: <strong>{fixedStore.name}</strong></p>
        ) : stores.length > 0 && (
          <Field label={canBeOrgWide ? "Store (leave empty for all stores)" : "Store"} htmlFor="u-store" error={errors.storeId?.message}>
            <NativeSelect id="u-store" aria-invalid={!!errors.storeId} {...register("storeId")}>
              <option value="">{canBeOrgWide ? "All stores (organisation-wide)" : "Select a store…"}</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </NativeSelect>
          </Field>
        )}
        <Field label="Temporary password" htmlFor="u-password" error={errors.password?.message} hint="At least 12 characters. Share it securely."><Input id="u-password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create user"}</Button>
        </div>
      </form>
    </FormSheet>
  );
}

const storeSchema = z.object({
  code: z.string().trim().min(2, "At least 2 characters").max(10, "At most 10 characters").toUpperCase(),
  name: z.string().trim().min(2, "Enter a store name"),
  address: z.string().trim().min(2, "Enter the store address or city"),
  registerCode: z.string().trim().max(12).toUpperCase().optional(),
  registerName: z.string().trim().max(60).optional(),
  createRegister: z.boolean(),
});
type StoreInput = z.input<typeof storeSchema>;

export function NewStoreSheet({ used, max }: { used: number; max: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<StoreInput>({ resolver: zodResolver(storeSchema), defaultValues: { code: "", name: "", address: "", registerCode: "REG-01", registerName: "Front Till", createRegister: true } });
  const full = used >= max;
  const withRegister = watch("createRegister");
  async function submit(value: StoreInput) {
    try {
      const created = await clientApi<{ id: string }>("/admin/stores", { method: "POST", body: JSON.stringify({ code: value.code, name: value.name, address: value.address, ...(value.createRegister ? { register: { code: value.registerCode || "REG-01", name: value.registerName || "Front Till" } } : {}) }) });
      toast.success("Store created. Next, assign its manager.");
      reset(); setOpen(false);
      router.push(`/org/stores/${created.id}`);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create store"); }
  }
  return (
    <FormSheet open={open} onOpenChange={setOpen} trigger={<Button disabled={full} title={full ? "Store limit reached" : undefined}><Plus /> New store</Button>} title="New store" description={`${used} of ${max} stores used. You will assign a manager on the next screen.`}>
      <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
        <Field label="Store code" htmlFor="s-code" error={errors.code?.message} hint="Short and unique, for example MUM01."><Input id="s-code" {...register("code")} /></Field>
        <Field label="Store name" htmlFor="s-name" error={errors.name?.message}><Input id="s-name" {...register("name")} /></Field>
        <Field label="Address" htmlFor="s-address" error={errors.address?.message}><Input id="s-address" {...register("address")} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("createRegister")} /> Create a register (till) now</label>
        {withRegister && <div className="grid grid-cols-2 gap-3">
          <Field label="Register code" htmlFor="s-rcode"><Input id="s-rcode" {...register("registerCode")} /></Field>
          <Field label="Register name" htmlFor="s-rname"><Input id="s-rname" {...register("registerName")} /></Field>
        </div>}
        {!withRegister && <p className="text-xs text-muted-foreground">Without a register nobody can open a till or sell in this store. You can add one later from the store page.</p>}
        <div className="flex justify-end gap-2 pt-2"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create store"}</Button></div>
      </form>
    </FormSheet>
  );
}

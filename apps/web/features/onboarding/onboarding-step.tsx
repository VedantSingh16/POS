"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { clientApi } from "@/features/client-api";

type StoreDraft = { id?: string; code: string; name: string; address: string; timezone: string; closeHour: string; registerCode: string; registerName: string };
type ManagerDraft = { storeId: string; firstName: string; lastName: string; email: string; password: string };
type Role = { id: string; name: string; description?: string; permissionCount?: number; isSystem?: boolean };
type Props = {
  currentStep: number;
  previous?: string;
  next?: string;
  initialData: Record<string, unknown>;
  organization: { name: string; maxStores: number };
  existingStores: StoreDraft[];
  roles: Role[];
  admin: { name: string; email: string };
};

const emptyStore = (n: number): StoreDraft => ({ code: `STORE-${String(n).padStart(2, "0")}`, name: "", address: "", timezone: "Asia/Kolkata", closeHour: "", registerCode: "REG-01", registerName: "Front Till" });
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function OnboardingStep({ currentStep, previous, next, initialData, organization, existingStores, roles, admin }: Props) {
  const router = useRouter();
  const initialOrg = asRecord(initialData.organization);
  const savedStores = Array.isArray(initialData.stores) ? initialData.stores as StoreDraft[] : null;
  const savedManagers = Array.isArray(initialData.managers) ? initialData.managers as ManagerDraft[] : [];
  const [busy, setBusy] = React.useState(false);
  const [problems, setProblems] = React.useState<string[]>([]);
  const [finished, setFinished] = React.useState(false);
  const [org, setOrg] = React.useState({
    name: String(initialOrg.name ?? organization.name), legalName: String(initialOrg.legalName ?? ""), tradeName: String(initialOrg.tradeName ?? ""),
    gstin: String(initialOrg.gstin ?? ""), address: String(initialOrg.address ?? ""), timezone: String(initialOrg.timezone ?? "Asia/Kolkata"), businessType: String(initialOrg.businessType ?? "RETAIL"),
  });
  const [stores, setStores] = React.useState<StoreDraft[]>(savedStores ?? (existingStores.length ? existingStores : [emptyStore(1)]));
  const [managers, setManagers] = React.useState<ManagerDraft[]>(() => {
    const prior = new Map(savedManagers.map((manager) => [manager.storeId, manager]));
    return (savedStores ?? existingStores).map((store) => {
      const old = prior.get(store.id ?? "");
      return { storeId: store.id ?? "", firstName: old?.firstName ?? "", lastName: old?.lastName ?? "", email: old?.email ?? "", password: "" };
    });
  });
  const savedAdmin = asRecord(initialData.administrator);
  const [first, ...rest] = admin.name.trim().split(/\s+/);
  const [account, setAccount] = React.useState({ firstName: first ?? "", lastName: rest.join(" "), currentPassword: "", password: "", confirmPassword: "", pin: "", confirmPin: "" });
  const pinAlreadySet = savedAdmin.secured === true;
  const setAccountField = (key: keyof typeof account, value: string) => setAccount((current) => ({ ...current, [key]: value }));
  const [rounding, setRounding] = React.useState(String(Number(initialData.cashRoundingCents ?? 0) / 100));

  React.useEffect(() => {
    if (stores.length > 0 && managers.length !== stores.length) {
      setManagers(stores.map((store) => managers.find((manager) => manager.storeId === store.id) ?? { storeId: store.id ?? "", firstName: "", lastName: "", email: "", password: "" }));
    }
  // This reconciles store ids after the store step creates them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores]);

  const setOrganizationField = (key: keyof typeof org, value: string) => setOrg((current) => ({ ...current, [key]: value }));
  const updateStore = (index: number, key: keyof StoreDraft, value: string) => setStores((current) => current.map((store, i) => i === index ? { ...store, [key]: value } : store));
  const updateManager = (index: number, key: keyof ManagerDraft, value: string) => setManagers((current) => current.map((manager, i) => i === index ? { ...manager, [key]: value } : manager));

  async function saveStep() {
    if (currentStep === 0) {
      await clientApi("/auth/profile", { method: "PATCH", body: JSON.stringify({ firstName: account.firstName.trim(), lastName: account.lastName.trim(), ...(account.password ? { password: account.password, currentPassword: account.currentPassword } : {}), ...(account.pin ? { pin: account.pin } : {}) }) });
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ currentStep, data: { administrator: { secured: true } } }) });
    } else if (currentStep === 1) {
      await clientApi("/admin/organization", { method: "PATCH", body: JSON.stringify(org) });
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ currentStep, data: { organization: org } }) });
    } else if (currentStep === 2) {
      const result = await clientApi<{ stores: (StoreDraft & { id: string; register: { code: string; name: string } })[] }>("/admin/onboarding/stores", { method: "POST", body: JSON.stringify({ stores }) });
      const saved = result.stores.map((store) => ({ ...store, registerCode: store.register.code, registerName: store.register.name, closeHour: store.closeHour === null ? "" : String(store.closeHour) }));
      setStores(saved);
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ currentStep, data: { stores: saved } }) });
    } else if (currentStep === 3) {
      if (managers.some((manager) => !manager.storeId)) throw new Error("Save the store step before assigning managers");
      const result = await clientApi<{ managers: Omit<ManagerDraft, "password">[] }>("/admin/onboarding/managers", { method: "POST", body: JSON.stringify({ managers }) });
      const saved = result.managers.map((manager) => ({ ...manager, password: "" }));
      setManagers(saved);
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ currentStep, data: { managers: saved } }) });
    } else if (currentStep === 5) {
      const cents = Math.round(Number(rounding || "0") * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error("Cash rounding must be zero or a positive amount");
      await clientApi("/admin/settings", { method: "PATCH", body: JSON.stringify({ cashRounding: cents }) });
      const { taxGroups = [] } = await clientApi<{ taxGroups?: { code?: string }[] }>("/admin/catalog/tax-groups");
      const existing = new Set(taxGroups.map((tax) => tax.code?.toUpperCase()));
      for (const rate of [0, 5, 12, 18, 28]) {
        if (!existing.has(`GST${rate}`)) await clientApi("/admin/catalog/tax-groups", { method: "POST", body: JSON.stringify({ code: `GST${rate}`, name: `GST ${rate}%`, ratePercent: rate }) });
      }
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ currentStep, data: { cashRoundingCents: cents } }) });
    } else {
      await clientApi("/admin/onboarding", { method: "PATCH", body: JSON.stringify({ currentStep }) });
    }
  }

  function validate(): string[] {
    const found: string[] = [];
    if (currentStep === 0) {
      if (!account.firstName.trim()) found.push("Enter your first name.");
      if (account.password) {
        if (!account.currentPassword) found.push("Enter your current password to set a new one.");
        if (account.password.length < 12) found.push("The new password must be at least 12 characters.");
        if (account.password !== account.confirmPassword) found.push("The two passwords do not match.");
      }
      if (account.pin || !pinAlreadySet) {
        if (!/^\d{4,8}$/.test(account.pin)) found.push("Set an approval PIN of 4 to 8 digits.");
        else if (account.pin !== account.confirmPin) found.push("The two PIN entries do not match.");
      }
    }
    if (currentStep === 1) {
      if (org.name.trim().length < 2) found.push("Enter the organisation name.");
      if (org.gstin.trim() && !GSTIN.test(org.gstin.trim().toUpperCase())) found.push("GSTIN must be 15 characters in the standard format, or left blank.");
    }
    if (currentStep === 2) {
      if (stores.length === 0) found.push("Add at least one store.");
      const codes = new Map<string, number>();
      stores.forEach((store, index) => {
        const label = store.name.trim() || `Store ${index + 1}`;
        if (store.name.trim().length < 2) found.push(`Store ${index + 1}: enter a store name.`);
        if (!/^[A-Za-z0-9-]{2,10}$/.test(store.code.trim())) found.push(`${label}: the store code must be 2–10 letters, numbers or hyphens.`);
        if (!store.address.trim()) found.push(`${label}: enter the store address.`);
        if (!store.registerCode.trim() || !store.registerName.trim()) found.push(`${label}: every store needs a register code and name so it can sell.`);
        if (store.closeHour !== "" && !(Number.isInteger(Number(store.closeHour)) && Number(store.closeHour) >= 0 && Number(store.closeHour) <= 23)) found.push(`${label}: close hour must be a whole number from 0 to 23.`);
        const key = store.code.trim().toUpperCase();
        codes.set(key, (codes.get(key) ?? 0) + 1);
      });
      for (const [code, n] of codes) if (n > 1) found.push(`The store code ${code} is used ${n} times. Codes must be unique.`);
    }
    if (currentStep === 3) {
      if (managers.length === 0) found.push("Save the store step first, then assign managers.");
      managers.forEach((manager, index) => {
        const label = stores[index]?.name || `Store ${index + 1}`;
        if (!manager.firstName.trim()) found.push(`${label}: enter the manager's first name.`);
        if (!EMAIL.test(manager.email.trim())) found.push(`${label}: enter a valid manager email.`);
        if (manager.password && manager.password.length < 12) found.push(`${label}: the initial password must be at least 12 characters.`);
      });
      const emails = managers.map((m) => m.email.trim().toLowerCase()).filter(Boolean);
      const passwords = managers.filter((m) => m.password);
      for (const email of new Set(emails.filter((e, i) => emails.indexOf(e) !== i))) {
        if (!passwords.some((m) => m.email.trim().toLowerCase() === email) && !savedManagers.some((m) => m.email.toLowerCase() === email)) found.push(`${email} manages more than one store: enter an initial password once, for the first store.`);
      }
    }
    if (currentStep === 5) {
      const cents = Math.round(Number(rounding || "0") * 100);
      if (!Number.isFinite(cents) || cents < 0) found.push("Cash rounding must be zero or a positive amount.");
    }
    if (currentStep === 7) {
      stores.forEach((store, index) => { if (!managers[index]?.email) found.push(`${store.name || `Store ${index + 1}`} has no manager. Go back to the managers step.`); });
    }
    return found;
  }

  function setStoreCount(raw: string) {
    const wanted = Math.min(organization.maxStores, Math.max(1, Math.floor(Number(raw) || 1)));
    setStores((current) => {
      if (wanted >= current.length) return [...current, ...Array.from({ length: wanted - current.length }, (_, i) => emptyStore(current.length + i + 1))];
      const next = [...current];
      while (next.length > wanted && !next[next.length - 1].id) next.pop();
      if (next.length > wanted) toast.info("Stores that are already saved can be deactivated later from Organisation → Stores.");
      return next;
    });
  }

  async function advance() {
    const found = validate();
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      if (currentStep === 7) {
        await clientApi("/admin/onboarding/finish", { method: "POST" });
        setFinished(true);
        router.refresh();
        return;
      }
      await saveStep();
      if (next) router.push(`/onboarding/${next}`);
    } catch (error) {
      setProblems([error instanceof Error ? error.message : "Could not save this setup step"]);
    } finally { setBusy(false); }
  }

  const field = (label: string, value: string, change: (value: string) => void, type = "text", props: React.ComponentProps<typeof Input> = {}) => <label className="grid gap-1 text-sm"><span>{label}</span><Input type={type} value={value} onChange={(event) => change(event.target.value)} {...props} /></label>;

  if (finished) return <div className="grid justify-items-center gap-4 py-6 text-center">
    <span className="grid size-14 place-items-center rounded-full bg-success-soft text-success"><CheckCircle2 className="size-8" /></span>
    <div><h2 className="text-xl font-semibold">{organization.name} is ready</h2><p className="mt-1 text-sm text-muted-foreground">{stores.length} store{stores.length === 1 ? "" : "s"} and {managers.length} manager{managers.length === 1 ? "" : "s"} have been saved. Managers sign in with the email you entered and see only their own store.</p></div>
    <ul className="grid gap-1 text-sm">{stores.map((store, index) => <li key={store.id ?? index}><span className="font-medium">{store.name}</span> <span className="text-muted-foreground">· {managers[index]?.email}</span></li>)}</ul>
    <Button size="touch" onClick={() => { router.replace("/org"); router.refresh(); }}>Open organisation dashboard</Button>
  </div>;

  return <div className="grid gap-5">
    {currentStep === 0 && <div className="grid gap-4">
      <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2">
        {field("First name", account.firstName, (value) => setAccountField("firstName", value), "text", { autoComplete: "given-name" })}
        {field("Last name", account.lastName, (value) => setAccountField("lastName", value), "text", { autoComplete: "family-name" })}
        <label className="grid gap-1 text-sm sm:col-span-2"><span>Administrator email (sign-in)</span><Input value={admin.email} readOnly aria-readonly className="bg-secondary text-muted-foreground" /><span className="text-xs text-muted-foreground">Set when you registered. You sign in with this address, and it cannot be changed here.</span></label>
        <div className="grid gap-1 sm:col-span-2"><p className="text-sm font-medium">Password</p><p className="text-xs text-muted-foreground">You chose a password when you registered. Enter a new one only if you want to replace it (at least 12 characters).</p></div>
        {field("Current password", account.currentPassword, (value) => setAccountField("currentPassword", value), "password", { autoComplete: "current-password", placeholder: "Only needed to set a new password" })}
        <div className="hidden sm:block" />
        {field("New password", account.password, (value) => setAccountField("password", value), "password", { autoComplete: "new-password", placeholder: "Leave blank to keep current" })}
        {field("Confirm new password", account.confirmPassword, (value) => setAccountField("confirmPassword", value), "password", { autoComplete: "new-password" })}
      </CardContent></Card>
      <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><p className="text-sm font-medium">Approval PIN {pinAlreadySet && <span className="ml-1 text-xs font-normal text-success">Already set</span>}</p><p className="text-xs text-muted-foreground">4 to 8 digits. It unlocks a till and confirms sensitive actions quickly, so your password is never typed in front of customers.{pinAlreadySet ? " Leave blank to keep your current PIN." : ""}</p></div>
        {field(pinAlreadySet ? "New PIN" : "PIN", account.pin, (value) => setAccountField("pin", value.replace(/\D/g, "").slice(0, 8)), "password", { inputMode: "numeric", autoComplete: "off" })}
        {field("Confirm PIN", account.confirmPin, (value) => setAccountField("confirmPin", value.replace(/\D/g, "").slice(0, 8)), "password", { inputMode: "numeric", autoComplete: "off" })}
      </CardContent></Card>
      <p className="rounded-md border-l-2 border-l-success bg-success-soft px-3 py-2 text-sm text-success">Role: Organisation Administrator. Full access to every store, team member, role and setting.</p>
    </div>}

    {currentStep === 1 && <div className="grid gap-3 sm:grid-cols-2">
      {field("Organisation name", org.name, (value) => setOrganizationField("name", value))}
      {field("Legal name", org.legalName, (value) => setOrganizationField("legalName", value))}
      {field("Trade name", org.tradeName, (value) => setOrganizationField("tradeName", value))}
      {field("GSTIN", org.gstin, (value) => setOrganizationField("gstin", value))}
      <label className="grid gap-1 text-sm sm:col-span-2">Address<Textarea value={org.address} onChange={(event) => setOrganizationField("address", event.target.value)} /></label>
      {field("Time zone", org.timezone, (value) => setOrganizationField("timezone", value))}
      <label className="grid gap-1 text-sm">Business type<NativeSelect value={org.businessType} onChange={(event) => setOrganizationField("businessType", event.target.value)}><option value="RETAIL">Retail</option><option value="GROCERY">Grocery</option><option value="PHARMACY">Pharmacy</option><option value="OTHER">Other</option></NativeSelect></label>
    </div>}

    {currentStep === 2 && <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">How many stores do you operate?<Input type="number" min={1} max={organization.maxStores} className="w-28" value={stores.length} onChange={(event) => setStoreCount(event.target.value)} /></label>
        <p className="pb-2 text-sm text-muted-foreground">Your plan allows up to {organization.maxStores}. Each store receives a stockroom and a register.</p>
      </div>
      {stores.map((store, index) => <Card key={store.id ?? index}><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="flex items-center justify-between sm:col-span-2"><h2 className="font-medium">Store {index + 1}{store.id ? " · saved" : ""}</h2>{!store.id && stores.length > 1 && <Button variant="ghost" size="icon" aria-label={`Remove store ${index + 1}`} onClick={() => setStores((current) => current.filter((_, i) => i !== index))}><Trash2 /></Button>}</div>
        {field("Store code", store.code, (value) => updateStore(index, "code", value))}
        {field("Store name", store.name, (value) => updateStore(index, "name", value))}
        {field("Address", store.address, (value) => updateStore(index, "address", value))}
        {field("Time zone", store.timezone, (value) => updateStore(index, "timezone", value))}
        {field("Business close hour (0–23)", store.closeHour, (value) => updateStore(index, "closeHour", value), "number", { min: 0, max: 23, placeholder: "Use organisation default" })}
        {field("Register code", store.registerCode, (value) => updateStore(index, "registerCode", value))}
        {field("Register name", store.registerName, (value) => updateStore(index, "registerName", value))}
      </CardContent></Card>)}
      {stores.length < organization.maxStores && <Button variant="outline" className="sm:w-fit" onClick={() => setStores((current) => [...current, emptyStore(current.length + 1)])}><Plus /> Add another store</Button>}
    </div>}

    {currentStep === 3 && <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">Assign one primary Store Manager to every store. Use an existing account email to add another store assignment, or provide an initial password for a new account.</p>
      {stores.map((store, index) => <Card key={store.id ?? index}><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">Manager of {store.name || `Store ${index + 1}`}</h2>
        {field("First name", managers[index]?.firstName ?? "", (value) => updateManager(index, "firstName", value))}
        {field("Last name", managers[index]?.lastName ?? "", (value) => updateManager(index, "lastName", value))}
        {field("Email", managers[index]?.email ?? "", (value) => updateManager(index, "email", value), "email")}
        {field("Initial password (new accounts only)", managers[index]?.password ?? "", (value) => updateManager(index, "password", value), "password", { autoComplete: "new-password", minLength: 12 })}
      </CardContent></Card>)}
      {stores.length === 0 && <p className="text-sm text-danger">Add and save at least one store first.</p>}
    </div>}

    {currentStep === 4 && <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">These built-in roles are available across the organisation. Store Managers receive a store-scoped grant for the store assigned in the previous step.</p>
      {roles.filter((role) => role.isSystem).map((role) => <Card key={role.id}><CardContent className="flex items-start justify-between gap-4 p-4"><div><h2 className="font-medium">{role.name}</h2><p className="text-sm text-muted-foreground">{role.description}</p></div><span className="shrink-0 text-xs text-muted-foreground">{role.permissionCount ?? 0} permissions</span></CardContent></Card>)}
      <p className="text-sm text-muted-foreground">You can create custom roles from Organisation → Roles after setup is complete.</p>
    </div>}

    {currentStep === 5 && <div className="grid gap-3 sm:max-w-sm">
      {field("Cash rounding (₹, 0 disables)", rounding, setRounding, "number", { min: 0, step: "0.01" })}
      <p className="text-sm text-muted-foreground">Default GST groups at 0%, 5%, 12%, 18% and 28% will be created if they do not already exist.</p>
    </div>}

    {currentStep === 6 && <div className="grid gap-3 text-sm">
      <Card><CardContent className="grid gap-2 p-4"><div className="flex items-center justify-between"><h2 className="font-medium">Organisation</h2><Link href="/onboarding/organization" className="text-xs font-medium text-primary hover:underline">Edit</Link></div><p>{org.name}</p><p className="text-muted-foreground">{org.address || "No address entered"} · {org.timezone}{org.gstin ? ` · GSTIN ${org.gstin}` : ""}</p></CardContent></Card>
      <Card><CardContent className="grid gap-2 p-4"><div className="flex items-center justify-between"><h2 className="font-medium">Administrator</h2></div><p>{admin.name} <span className="text-muted-foreground">· {admin.email}</span></p><p className="text-muted-foreground">Organisation-wide access to every store.</p></CardContent></Card>
      <Card><CardContent className="grid gap-2 p-4"><div className="flex items-center justify-between"><h2 className="font-medium">Stores and managers ({stores.length})</h2><span className="flex gap-3 text-xs font-medium text-primary"><Link href="/onboarding/stores" className="hover:underline">Edit stores</Link><Link href="/onboarding/managers" className="hover:underline">Edit managers</Link></span></div>
        <ul className="divide-y">{stores.map((store, index) => <li key={store.id ?? index} className="grid gap-0.5 py-2"><span className="font-medium">{store.name || store.code} <span className="font-mono text-xs text-muted-foreground">{store.code}</span></span><span className="text-muted-foreground">{store.address || "No address"} · register {store.registerName} ({store.registerCode})</span><span className={managers[index]?.email ? "" : "text-danger"}>{managers[index]?.email ? `Manager: ${[managers[index].firstName, managers[index].lastName].filter(Boolean).join(" ")} · ${managers[index].email}` : "Manager not assigned"}</span></li>)}</ul></CardContent></Card>
      <Card><CardContent className="grid gap-1 p-4"><div className="flex items-center justify-between"><h2 className="font-medium">Tax and receipts</h2><Link href="/onboarding/tax-receipts" className="text-xs font-medium text-primary hover:underline">Edit</Link></div><p className="text-muted-foreground">GST groups 0%, 5%, 12%, 18% and 28% · cash rounding {Number(rounding || 0) > 0 ? `₹${rounding}` : "off"}</p></CardContent></Card>
    </div>}

    {currentStep === 7 && <Card><CardContent className="grid gap-2 p-4 text-sm"><h2 className="font-medium">Confirm and finish</h2><p className="text-muted-foreground">This confirms the setup you reviewed: {organization.name}, {stores.length} store{stores.length === 1 ? "" : "s"} and their managers. Finishing requires every active store to have an active register and an assigned Store Manager. Stores, registers and manager accounts have already been saved at each step.</p></CardContent></Card>}

    {problems.length > 0 && <div role="alert" className="flex gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><ul className="grid gap-1">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}

    <div className="flex justify-between"><span>{previous ? <button className={buttonVariants({ variant: "outline", size: "touch" })} onClick={() => router.push(`/onboarding/${previous}`)}>Back</button> : null}</span><Button size="touch" onClick={() => void advance()} disabled={busy}>{busy ? "Saving…" : currentStep === 7 ? "Confirm and finish setup" : next ? "Save and continue" : "Finish setup"}</Button></div>
  </div>;
}

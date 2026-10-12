import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/data/primitives";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InviteUserSheet } from "@/features/forms";
import { AddRegisterSheet, StoreStatusButton } from "@/features/store/store-admin";
import { StoreSettingsForm } from "@/features/store/store-settings-form";
import { StoreStaffTable } from "@/features/store/store-tables";
import { RegistersTable } from "@/features/tables";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Store" };

export default async function StoreDetail({ params }: PageProps<"/org/stores/[id]">) {
  const me = await requirePermission("stores.view");
  const { id } = await params;
  const { data: store } = await api.store(id).catch(() => ({ data: null }));
  if (!store) notFound();
  const [{ data: registers }, { data: staff }, { data: settings }, { data: stores }, { data: roles }] = await Promise.all([api.registers(id), api.storeStaff(id), api.storeSettings(id), api.stores(), api.roles()]);
  const managers = stores.find((s) => s.id === id)?.managers ?? [];
  const org = me.permissions.organization;
  const canManageStore = org.includes("stores.manage");
  const canManageUsers = org.includes("users.manage");
  const canManageRegisters = org.includes("registers.manage");
  const setupIssues = [
    registers.length === 0 && "This store has no register, so nobody can open a till or sell here.",
    managers.length === 0 && "This store has no manager assigned.",
  ].filter(Boolean) as string[];
  return (
    <>
      <PageHeader title={store.name} description={`Store code ${store.code}${store.city ? ` · ${store.city}` : ""}`} crumbs={[{ label: "Organisation", href: "/org" }, { label: "Stores", href: "/org/stores" }, { label: store.name }]}
        actions={<>
          <Link href={`/s/${store.id}`} className={buttonVariants()}>Open store operations <ArrowRight /></Link>
          {canManageStore && <StoreStatusButton storeId={store.id} storeName={store.name} status={store.status} />}
        </>} />
      {setupIssues.length > 0 && (
        <div role="status" className="mb-4 flex gap-3 rounded-lg border border-warning bg-warning-soft p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <ul className="grid gap-1">{setupIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      )}
      <Tabs defaultValue="overview">
        <TabsList>{[["overview", "Overview"], ["registers", "Registers"], ["team", "Team"], ["settings", "Settings"]].map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList>
        <TabsContent value="overview"><Card><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Status</p><StatusBadge status={store.status} /></div>
          <div><p className="text-xs text-muted-foreground">Store manager</p>{managers.length ? <ul className="text-sm">{managers.map((m) => <li key={m.id}>{m.name}<span className="block text-xs text-muted-foreground">{m.email}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Not assigned</p>}</div>
          <div><p className="text-xs text-muted-foreground">Registers</p><p className="text-sm">{store.registerCount}</p></div>
          <div><p className="text-xs text-muted-foreground">Staff assigned</p><p className="text-sm">{staff.length}</p></div>
        </CardContent></Card></TabsContent>
        <TabsContent value="registers">
          {canManageRegisters && <div className="mb-3 flex justify-end"><AddRegisterSheet storeId={store.id} existing={registers.length} /></div>}
          <RegistersTable data={registers} storeId={store.id} admin />
        </TabsContent>
        <TabsContent value="team">
          {canManageUsers && <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">People here can only work in {store.name}. Assign the Store Manager role to give someone responsibility for this store.</p><InviteUserSheet roles={roles.map((r) => ({ id: r.id, name: r.name, system: Boolean(r.system) }))} fixedStore={{ id: store.id, name: store.name }} /></div>}
          <StoreStaffTable data={staff} />
        </TabsContent>
        <TabsContent value="settings"><Card><CardContent><StoreSettingsForm initial={settings} /></CardContent></Card></TabsContent>
      </Tabs>
    </>
  );
}

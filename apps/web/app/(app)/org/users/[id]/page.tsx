import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/data/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditTable } from "@/features/tables";
import { api } from "@/features/api";
import { UserAdminActions } from "@/features/actions";
import { UserAccessSheet } from "@/features/users/user-access";

export default async function UserDetail({ params }: PageProps<"/org/users/[id]">) {
  const me = await requirePermission("users.view");
  const { id } = await params;
  const { data: user } = await api.user(id);
  if (!user) notFound();
  const [{ data: audit }, { data: access }, { data: roles }, { data: stores }] = await Promise.all([api.audit(), api.effectiveAccess(id), api.roles(), api.stores()]);
  const canManage = me.permissions.organization.includes("users.manage");
  return (
    <>
      <PageHeader title={user.name} description={user.email} crumbs={[{ label: "Organisation", href: "/org" }, { label: "Team members", href: "/org/users" }, { label: user.name }]} backHref="/org/users" backLabel="Back to team members" actions={canManage ? <><UserAccessSheet userId={user.id} userName={user.name} current={(user.roles ?? []) as { id: string; name: string; scopeType: string; scopeId: string | null }[]} roles={roles.map((r) => ({ id: r.id, name: r.name, system: Boolean(r.system) }))} stores={stores.map((s) => ({ id: s.id, name: s.name }))} /><UserAdminActions id={user.id} name={user.name} status={user.status} self={user.id === me.user.userId} /></> : undefined} />
      <Tabs defaultValue="profile">
        <TabsList><TabsTrigger value="profile"><LocalizedText value={"Profile"} /></TabsTrigger><TabsTrigger value="access"><LocalizedText value={"Access"} /></TabsTrigger><TabsTrigger value="activity"><LocalizedText value={"Activity"} /></TabsTrigger></TabsList>
        <TabsContent value="profile"><Card><CardContent className="grid gap-3 sm:grid-cols-2">
          <div><p className="text-xs text-muted-foreground"><LocalizedText value={"Email"} /></p><p>{user.email}</p></div>
          <div><p className="text-xs text-muted-foreground"><LocalizedText value={"Status"} /></p><StatusBadge status={user.status} /></div>
          <div><p className="text-xs text-muted-foreground"><LocalizedText value={"Role"} /></p><p>{user.role}</p></div>
          <div><p className="text-xs text-muted-foreground"><LocalizedText value={"Works in"} /></p><p>{user.scope}</p></div>
        </CardContent></Card></TabsContent>
        <TabsContent value="access"><Card><CardContent><p className="mb-3 font-medium"><LocalizedText value={"Effective access"} /></p><div className="divide-y">{access.grants.map((grant: { permission: string; sourceRole: string; scopeType: string; store?: { name: string } | null }) => <div key={`${grant.permission}-${grant.sourceRole}-${grant.store?.name ?? grant.scopeType}`} className="grid grid-cols-3 gap-3 py-2 text-sm"><span className="font-mono text-xs">{grant.permission}</span><span>{grant.sourceRole}</span><span className="text-muted-foreground">{grant.scopeType}{grant.store ? ` · ${grant.store.name}` : ""}</span></div>)}</div></CardContent></Card></TabsContent>
        <TabsContent value="activity"><AuditTable data={audit} /></TabsContent>
      </Tabs>
    </>
  );
}

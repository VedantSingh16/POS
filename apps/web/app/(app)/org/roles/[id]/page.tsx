import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PermissionMatrix } from "@/features/permission-matrix";
import { api } from "@/features/api";
import { requireSession } from "@/lib/server/session";

export default async function RoleDetail({ params }: PageProps<"/org/roles/[id]">) {
  await requirePermission("roles.view");
  const me = await requireSession();
  const { id } = await params;
  const { data: role } = await api.role(id);
  if (!role) notFound();
  const { data: groups } = await api.permissionGroups();
  return (
    <>
      <PageHeader title={role.name} description={role.description} crumbs={[{ label: "Organisation", href: "/org" }, { label: "Roles", href: "/org/roles" }, { label: role.name }]} backHref="/org/roles" backLabel="Back to roles" />
      <Card>
        <CardHeader><CardTitle><LocalizedText value={"Permissions"} /></CardTitle><span className="text-xs text-muted-foreground"><LocalizedText value={role.system ? "System role: read only" : "Custom role"} /></span></CardHeader>
        <CardContent><PermissionMatrix groups={groups} roleId={role.id} initialEffects={role.permissionEffects} initialStoreAssignable={role.storeAssignable} readOnly={role.system || !me.permissions.organization.includes("roles.manage")} /></CardContent>
      </Card>
    </>
  );
}

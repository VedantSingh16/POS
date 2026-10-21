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
  const isAdministratorTemplate = role.templateKey === "org_admin";
  const statusLabel = isAdministratorTemplate
    ? "Administrator role: always has every permission"
    : role.isSystem
      ? role.customized ? "System role · modified from default" : "System role · follows default"
      : "Custom role";
  const readOnly = isAdministratorTemplate || !me.permissions.organization.includes("roles.manage");
  return (
    <>
      <PageHeader title={role.name} description={role.description} crumbs={[{ label: "Organisation", href: "/org" }, { label: "Roles", href: "/org/roles" }, { label: role.name }]} backHref="/org/roles" backLabel="Back to roles" />
      <Card>
        <CardHeader><CardTitle><LocalizedText value={"Permissions"} /></CardTitle><span className="text-xs text-muted-foreground"><LocalizedText value={statusLabel} /></span></CardHeader>
        <CardContent>
          <PermissionMatrix
            key={`${role.id}:${role.updatedAt}`}
            groups={groups}
            roleId={role.id}
            roleName={role.name}
            initialEffects={role.permissionEffects}
            initialStoreAssignable={role.storeAssignable}
            readOnly={readOnly}
            templateKey={role.templateKey}
            defaultPermissionEffects={role.defaultPermissionEffects}
            customized={role.customized}
            templateUpdateAvailable={role.templateUpdateAvailable}
          />
        </CardContent>
      </Card>
    </>
  );
}

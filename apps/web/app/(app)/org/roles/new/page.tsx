import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { PageHeader } from "@/components/app/page-header";
import { RoleEditor } from "@/features/role-editor";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("New role") }; }

export default async function NewRolePage() {
  await requirePermission("roles.view");
  await requirePermission("roles.manage");
  const { data: groups } = await api.permissionGroups();
  return (
    <>
      <PageHeader title="New role" description="Choose the actions this role can perform." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Roles", href: "/org/roles" }, { label: "New role" }]} backHref="/org/roles" backLabel="Back to roles" />
      <RoleEditor groups={groups} />
    </>
  );
}

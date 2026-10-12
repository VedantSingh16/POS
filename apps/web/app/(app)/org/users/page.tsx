import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { InviteUserSheet } from "@/features/forms";
import { UsersTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Team members" };

export default async function UsersPage() {
  await requirePermission("users.view");
  const [{ data }, { data: roles }, { data: stores }] = await Promise.all([api.users(), api.roles(), api.stores()]);
  return (
    <>
      <PageHeader title="Team members" description="People who can sign in, the role each one holds, and which store or stores they can work in." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Team members" }]} actions={<InviteUserSheet roles={roles.map((r) => ({ id: r.id, name: r.name, system: Boolean(r.system) }))} stores={stores.map((s) => ({ id: s.id, name: s.name }))} />} />
      <UsersTable data={data} />
    </>
  );
}

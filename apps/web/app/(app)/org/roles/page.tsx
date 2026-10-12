import { requirePermission } from "@/lib/server/session";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { RolesTable } from "@/features/tables";
import { api } from "@/features/api";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Roles" };

export default async function RolesPage() {
  await requirePermission("roles.view");
  const { data } = await api.roles();
  return (
    <>
      <PageHeader title="Roles" description="Bundles of permissions you can assign organisation-wide or per store." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Roles" }]} actions={<Link href="/org/roles/new" className={buttonVariants()}><Plus /> New role</Link>} />
      <RolesTable data={data} />
    </>
  );
}

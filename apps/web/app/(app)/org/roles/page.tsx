import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { RolesTable } from "@/features/tables";
import { api } from "@/features/api";
import { buttonVariants } from "@/components/ui/button";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Roles") }; }

export default async function RolesPage() {
  await requirePermission("roles.view");
  const { data } = await api.roles();
  return (
    <>
      <PageHeader title="Roles" description="Bundles of permissions you can assign organisation-wide or per store." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Roles" }]} actions={<Link href="/org/roles/new" className={buttonVariants()}><Plus /> <LocalizedText value={"New role"} /></Link>} />
      <RolesTable data={data} />
    </>
  );
}

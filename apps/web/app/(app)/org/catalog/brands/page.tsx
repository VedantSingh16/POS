import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { NamedTable } from "@/features/tables";
import { NewBrandSheet } from "@/features/catalog/record-forms";
import { api } from "@/features/api";
import { redirect } from "next/navigation";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Brands") }; }

export default async function Page() {
  const me = await requirePermission("catalog.view");
  const { data: fields } = await api.catalogFieldConfig();
  if (!fields.coreFields.includes("brand")) redirect("/org/catalog/products");
  const { data } = await api.brands();
  const canManage = me.permissions.organization.includes("catalog.manage");
  return (
    <>
      <PageHeader
        title="Brands"
        description="Brands are shared across every store. Pick one when you add a product."
        crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Brands" }]}
        actions={canManage ? <NewBrandSheet /> : undefined}
      />
      <NamedTable data={data} noun="Brand" />
    </>
  );
}

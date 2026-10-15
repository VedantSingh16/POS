import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { NewCategorySheet } from "@/features/catalog/record-forms";
import { NamedTable } from "@/features/tables";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Categories") }; }

export default async function Page() {
  await requirePermission("catalog.view");
  const { data } = await api.categories();
  return (
    <>
      <PageHeader title="Categories" description="Organisation-wide catalogue structure." crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Categories" }]} actions={<NewCategorySheet />} />
      <NamedTable data={data} noun="Category" />
    </>
  );
}

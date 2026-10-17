import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { CategoryTree } from "@/features/catalog/category-tree";
import { hasPermission } from "@/lib/permissions";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Categories") }; }

export default async function Page() {
  const me = await requirePermission("catalog.view");
  const { data } = await api.categories();
  return (
    <>
      <PageHeader title="Categories" description="Organise products into categories and subcategories." crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Categories" }]} />
      <CategoryTree categories={data} canManage={hasPermission(me, "catalog.manage")} />
    </>
  );
}

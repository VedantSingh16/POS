import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { ProductTypesManager } from "@/features/catalog/product-types-manager";
import { api } from "@/features/api";

export const metadata = { title: "Product setup rules" };

export default async function Page() {
  const me = await requirePermission("catalog.view");
  const [{ data: types }, { data: categories }, { data: brands }] = await Promise.all([api.productTypes(), api.categories(), api.brands()]);
  const canManage = me.permissions.organization.includes("catalog.manage");
  return (
    <>
      <PageHeader
        title="Product setup rules"
        description="A setup rule is a reusable checklist for a kind of product, such as packaged food. It can require a barcode or tax group and add extra fields. It does not set stock, category, or unit."
        crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Setup rules" }]}
      />
      <ProductTypesManager types={types} categories={categories.map((c) => ({ id: c.id, name: c.name }))} brands={brands.map((b) => ({ id: b.id, name: b.name }))} canManage={canManage} />
    </>
  );
}

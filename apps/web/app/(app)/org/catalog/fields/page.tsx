import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { FieldConfigurationEditor } from "@/features/settings/field-configuration-editor";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Product fields" };

export default async function Page() {
  await requirePermission("org.settings.manage");
  const { data } = await api.settings();
  return <>
        <PageHeader title="Product fields" description="Define the shared product and variant fields used by every store. Store users can view these values, but only organization users can change them." crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Product fields" }]} />
    <Card><CardContent className="grid gap-4"><FieldConfigurationEditor scope="organisation" domain="productFields" initial={data.productFields as never} /></CardContent></Card>
  </>;
}

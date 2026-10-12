import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { NewTaxGroupSheet } from "@/features/catalog/record-forms";
import { TaxTable } from "@/features/tables";
import { api } from "@/features/api";

export const metadata = { title: "Tax groups" };

export default async function Page() {
  await requirePermission("tax.view");
  const { data } = await api.taxGroups();
  return (
    <>
      <PageHeader title="Tax groups" description="Organisation-wide catalogue structure." crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Tax groups" }]} actions={<NewTaxGroupSheet />} />
      <TaxTable data={data} />
    </>
  );
}

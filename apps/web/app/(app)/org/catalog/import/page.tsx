import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { ImportWizard } from "@/features/catalog/import-wizard";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Import products") }; }

export default async function ImportPage() {
  await requirePermission("catalog.manage");
  return (
    <>
      <PageHeader title="Import products" description="Upload a CSV, review the rows, then confirm." crumbs={[{ label: "Catalogue" }, { label: "Products", href: "/org/catalog/products" }, { label: "Import" }]} backHref="/org/catalog/products" backLabel="Back to product catalogue" />
      <ImportWizard />
    </>
  );
}

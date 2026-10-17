import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { NewCustomerSheet } from "@/features/actions";
import { CustomersTable } from "@/features/tables";
import { api } from "@/features/api";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Customers") }; }

export default async function CustomersPage() {
  await requirePermission("customer.view");
  const [{ data }, { data: stores }, { data: profile }] = await Promise.all([api.customers(), api.stores(), api.orgProfile()]);
  return (
    <>
      <PageHeader title="Customers" description="Shared across every store." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Customers" }]} actions={<NewCustomerSheet stores={stores.map((s) => ({ id: s.id, name: s.name, code: s.code }))} taxRegime={profile.taxRegime} />} />
      <CustomersTable data={data} />
    </>
  );
}

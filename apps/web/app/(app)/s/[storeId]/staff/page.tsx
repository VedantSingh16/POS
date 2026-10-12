import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { StoreStaffTable } from "@/features/store/store-tables";
import { api } from "@/features/api";

export const metadata = { title: "Staff" };

export default async function Page({ params }: PageProps<"/s/[storeId]/staff">) {
  const { storeId } = await params;
  await requirePermission("store.staff.view", storeId);
  const { data } = await api.storeStaff(storeId);
  return (
    <>
      <PageHeader title="Staff" description="People assigned to this store." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Staff" }]} />
      <StoreStaffTable data={data} />
    </>
  );
}

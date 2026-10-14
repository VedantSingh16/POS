import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { StoreStaffTable } from "@/features/store/store-tables";
import { api } from "@/features/api";

export const metadata = { title: "Staff" };

export default async function Page({ params }: PageProps<"/s/[storeId]/staff">) {
  const { storeId } = await params;
  const me = await requirePermission("store.staff.view", storeId);
  const canManage = (me.permissions.stores[storeId] ?? []).includes("store.staff.manage");
  const [{ data }, { data: roleOptions }] = await Promise.all([
    api.storeStaff(storeId),
    canManage ? api.storeAssignableRoles(storeId) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  return (
    <>
      <PageHeader title="Staff" description="People assigned to this store." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Staff" }]} />
      <StoreStaffTable data={data} storeId={storeId} roleOptions={roleOptions} canManage={canManage} />
    </>
  );
}

import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { StoreStaffTable } from "@/features/store/store-tables";
import { api } from "@/features/api";
import { StoreCashiersPanel } from "@/features/store/store-cashiers-panel";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Staff") }; }

export default async function Page({ params }: PageProps<"/s/[storeId]/staff">) {
  const { storeId } = await params;
  const me = await requirePermission("store.staff.view", storeId);
  const permissions = me.permissions.stores[storeId] ?? [];
  const canManageStaff = permissions.includes("store.staff.manage");
  const canManageCashiers = permissions.includes("store.cashiers.manage");
  const [{ data }, { data: roleOptions }, { data: cashiers }, { data: till }] = await Promise.all([
    api.storeStaff(storeId),
    canManageStaff ? api.storeAssignableRoles(storeId) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    api.storeCashiers(storeId).catch(() => ({ data: [] as { id: string; displayName: string; employeeCode: string; status: string; hasPin: boolean }[] })),
    api.storeTill(storeId).catch(() => ({ data: { exists: false, loginId: "Unavailable" } })),
  ]);
  return (
    <>
      <PageHeader title="Staff" description="People assigned to this store." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: "Staff" }]} />
      <StoreCashiersPanel storeId={storeId} initialCashiers={cashiers} initialTill={till} canManage={canManageCashiers} />
      <StoreStaffTable data={data} storeId={storeId} roleOptions={roleOptions} canManage={canManageStaff} />
    </>
  );
}

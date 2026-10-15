import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { PageHeader } from "@/components/app/page-header";
import { StoreSettingsForm } from "@/features/store/store-settings-form";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Store profile") }; }
export default async function StoreProfileSettings({ params }: PageProps<"/s/[storeId]/settings/profile">) {
  const { storeId } = await params;
  const me = await requirePermission("store.settings.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const { data } = await api.storeSettings(storeId);
  const canEdit = (me.permissions.stores[storeId] ?? []).includes("store.settings.manage");
  return <>
    <PageHeader title="Store profile" description="Store identity, invoice details, time zone, and business close hour." crumbs={[{ label: "Settings", href: `/s/${storeId}/settings/profile` }, { label: store?.name ?? "Store" }, { label: "Store profile" }]} />
    <StoreSettingsForm initial={data} canEdit={canEdit} />
  </>;
}

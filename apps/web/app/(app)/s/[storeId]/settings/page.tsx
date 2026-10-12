import { PageHeader } from "@/components/app/page-header";
import { StoreSettingsForm } from "@/features/store/store-settings-form";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Store settings" };
export default async function StoreSettings({ params }: PageProps<"/s/[storeId]/settings">) {
  const { storeId } = await params;
  const me = await requirePermission("store.settings.view", storeId);
  const store = me.stores.find((value) => value.id === storeId);
  const { data } = await api.storeSettings(storeId);
  return <>
    <PageHeader title="Store settings" description="Settings for this store only." crumbs={[{ label: "Store", href: `/s/${storeId}` }, { label: store?.name ?? "Store" }, { label: "Settings" }]} />
    <StoreSettingsForm initial={data} />
  </>;
}

import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import { SettingsSectionNav } from "@/features/settings/settings-section-nav";

export default async function StoreSettingsLayout({ children, params }: LayoutProps<"/s/[storeId]/settings">) {
  const { storeId } = await params;
  await requirePermission("store.settings.view", storeId);
  const sections = [
    { label: "Store profile", href: `/s/${storeId}/settings/profile` },
    { label: "Billing & checkout", href: `/s/${storeId}/settings/billing` },
    { label: "Tax groups", href: `/s/${storeId}/settings/tax` },
  ];

  return <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <aside className="min-w-0 lg:pr-2">
      <p className="mb-2 hidden px-3 text-xs font-medium text-muted-foreground lg:block"><LocalizedText value={"Store settings"} /></p>
      <SettingsSectionNav items={sections} />
    </aside>
    <div className="min-w-0">{children}</div>
  </div>;
}

import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { SettingsSectionNav } from "@/features/settings/settings-section-nav";

const TABS = [
  { label: "General", href: "/org/settings/general" },
  { label: "Tax profile", href: "/org/settings/tax" },
  { label: "Approvals", href: "/org/settings/approvals" },
  { label: "Security", href: "/org/settings/security" },
];

export default async function SettingsLayout({ children }: LayoutProps<"/org/settings">) {
  await requirePermission("org.settings.manage");
  return (
    <>
      <PageHeader title="Organisation settings" description="Manage organization profile, shared product setup, and access." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Organisation settings" }]} />
      <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <SettingsSectionNav items={TABS} />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}

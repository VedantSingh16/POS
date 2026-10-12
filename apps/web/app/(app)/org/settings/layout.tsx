import { requirePermission } from "@/lib/server/session";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";

const TABS = [["general", "General"], ["tax", "Tax"], ["receipts", "Receipts"], ["approvals", "Approvals"], ["security", "Security"]];

export default async function SettingsLayout({ children }: LayoutProps<"/org/settings">) {
  await requirePermission("org.settings.manage");
  return (
    <>
      <PageHeader title="Organisation settings" description="Defaults that apply to every store in the organisation." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Organisation settings" }]} />
      <nav aria-label="Settings sections" className="mb-4 flex gap-1 border-b">
        {TABS.map(([slug, label]) => <Link key={slug} href={`/org/settings/${slug}`} className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">{label}</Link>)}
      </nav>
      {children}
    </>
  );
}

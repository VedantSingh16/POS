import Link from "next/link";
import { LocalizedText } from "@/components/i18n/localized-text";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export default async function CatalogueLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  await requirePermission("catalog.view");
  const { data: fields } = await api.catalogFieldConfig();
  const tabs = [
    { label: "Products", href: "/org/catalog/products" },
    { label: "Categories", href: "/org/catalog/categories" },
    ...(fields.coreFields.includes("brand") ? [{ label: "Brands", href: "/org/catalog/brands" }] : []),
    { label: "Units", href: "/org/catalog/units" },
    { label: "Tax", href: "/org/catalog/tax" },
    { label: "Import", href: "/org/catalog/import" },
    { label: "Setup", href: "/org/catalog/setup" },
  ];
  return <>
    <nav aria-label="Catalogue sections" className="mb-5 flex flex-wrap gap-2 border-b pb-3">{tabs.map((tab) => <Link key={tab.href} href={tab.href} className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"><LocalizedText value={tab.label} /></Link>)}</nav>
    {children}
    {modal}
  </>;
}

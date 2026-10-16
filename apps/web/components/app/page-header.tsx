"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useMaybeMe } from "@/components/app/session-context";
import { hasOrgScope } from "@/lib/permissions";
import { LocalizedText, useTranslate } from "@/components/i18n/localized-text";

export type Crumb = { label: string; href?: string };

/**
 * Store pages always show where the store sits: Organisation › Stores › <store> › page for administrators,
 * and just <store> › page for people who only work in that store.
 */
function withStoreContext(items: Crumb[], pathname: string, me: ReturnType<typeof useMaybeMe>): Crumb[] {
  const match = pathname.match(/^\/s\/([^/]+)/);
  if (!match || !me) return items;
  const store = me.stores.find((s) => s.id === match[1]);
  if (!store) return items;
  const rest = items.filter((crumb, index) => !(index === 0 && (crumb.label === "Store" || crumb.label === "Stores")) && crumb.label !== store.name);
  const storeCrumb: Crumb = { label: store.name, href: rest.length ? `/s/${store.id}` : undefined };
  return [...(hasOrgScope(me) ? [{ label: "Organisation", href: "/org" }, { label: "Stores", href: "/org/stores" }] : []), storeCrumb, ...rest];
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const t = useTranslate();
  const pathname = usePathname();
  const me = useMaybeMe();
  const list = withStoreContext(items, pathname, me);
  return (
    <nav aria-label={t("Breadcrumb")} className="mb-2 flex flex-wrap items-center gap-1 text-sm font-medium text-muted-foreground">
      {list.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3 rtl:rotate-180" aria-hidden />}
          {c.href && i < list.length - 1 ? <Link href={c.href} className="hover:text-foreground hover:underline"><LocalizedText value={c.label} /></Link> : <span aria-current={i === list.length - 1 ? "page" : undefined}><LocalizedText value={c.label} /></span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ title, description, actions, crumbs, backHref, backLabel }: { title: string; description?: string; actions?: React.ReactNode; crumbs?: Crumb[]; backHref?: string; backLabel?: string }) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-x-8 gap-y-4 sm:items-end">
      <div className="min-w-0">
        {backHref && <Link href={backHref} className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /><LocalizedText value={backLabel ?? "Back"} /></Link>}
        {crumbs && <Breadcrumbs items={crumbs} />}
        <div className="flex items-center gap-2">
          <h1 className="max-w-4xl font-display text-[clamp(2rem,3.4vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.05em] text-foreground"><LocalizedText value={title} /></h1>
        </div>
        {description && <p className="mt-3 max-w-3xl text-[17px] leading-[1.55] text-muted-foreground"><LocalizedText value={description} /></p>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 pb-0.5 sm:w-auto">{actions}</div>}
    </header>
  );
}

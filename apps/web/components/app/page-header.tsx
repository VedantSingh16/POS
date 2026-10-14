"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useMaybeMe } from "@/components/app/session-context";
import { hasOrgScope } from "@/lib/permissions";

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
  const pathname = usePathname();
  const me = useMaybeMe();
  const list = withStoreContext(items, pathname, me);
  return (
    <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {list.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3" aria-hidden />}
          {c.href && i < list.length - 1 ? <Link href={c.href} className="hover:text-foreground hover:underline">{c.label}</Link> : <span aria-current={i === list.length - 1 ? "page" : undefined}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function PageHeader({ title, description, actions, crumbs, backHref, backLabel }: { title: string; description?: string; actions?: React.ReactNode; crumbs?: Crumb[]; backHref?: string; backLabel?: string }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {backHref && <Link href={backHref} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"><ArrowLeft className="size-3.5" aria-hidden />{backLabel ?? "Back"}</Link>}
        {crumbs && <Breadcrumbs items={crumbs} />}
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[1.35rem] font-semibold tracking-tight">{title}</h1>
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

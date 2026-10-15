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
    <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs font-medium text-muted-foreground">
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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {backHref && <Link href={backHref} className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-4" aria-hidden />{backLabel ?? "Back"}</Link>}
        {crumbs && <Breadcrumbs items={crumbs} />}
        <div className="flex items-center gap-2">
          <h1 className="max-w-4xl font-display text-[clamp(1.65rem,2.3vw,2rem)] font-bold leading-[1.12] tracking-[-0.055em] text-foreground">{title}</h1>
        </div>
        {description && <p className="mt-2 max-w-3xl text-[15px] leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pb-0.5">{actions}</div>}
    </header>
  );
}

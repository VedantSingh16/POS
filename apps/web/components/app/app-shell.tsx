"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import { ArrowLeft, Bell, Building2, Check, ChevronDown, ChevronsUpDown, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Store as StoreIcon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { groupNavItems, isNavGroupOpen, isNavItemActive, navMode, resolveHref, toggleNavGroup, visibleNav, type NavMode } from "@/lib/nav";
import { hasOrgScope, isOrganisationReadOnlyStoreView } from "@/lib/permissions";
import { useMe } from "@/components/app/session-context";
import { IdleLock, UserMenu } from "@/components/app/user-menu";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/brand-mark";

export type ShellStore = { id: string; code: string; name: string };
type Ctx = { stores: ShellStore[]; storeId: string; orgName: string; mode: NavMode; setPaletteOpen: (v: boolean) => void };
const ShellContext = React.createContext<Ctx | null>(null);
const useShell = () => { const c = React.useContext(ShellContext); if (!c) throw new Error("AppShell missing"); return c; };

function activeStoreId(pathname: string, fallback: string) {
  const m = pathname.match(/^\/s\/([^/]+)/);
  return m ? m[1] : fallback;
}

/** Tells the user, in the sidebar itself, which area they are in and how to leave it. */
function ContextCard({ collapsed }: { collapsed: boolean }) {
  const { stores, storeId, orgName, mode } = useShell();
  const me = useMe();
  const store = stores.find((s) => s.id === storeId);
  const canLeaveToOrg = hasOrgScope(me);
  if (collapsed) {
    return <div className="mx-2 mt-3 grid h-10 place-items-center rounded-xl border border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground" title={mode === "org" ? `Organisation: ${orgName}` : `Store: ${store?.name ?? ""}`}>{mode === "org" ? <Building2 className="size-4" /> : <StoreIcon className="size-4" />}</div>;
  }
  return (
    <div className="mx-3 mt-3 rounded-xl border border-sidebar-border-soft bg-sidebar-surface p-3.5 text-sidebar-foreground">
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">{mode === "org" ? "Organisation" : "Store workspace"}</p>
      <p className="mt-1.5 flex items-center gap-2 truncate text-lg font-semibold tracking-tight">
        {mode === "org" ? <Building2 className="size-[18px] shrink-0 text-sidebar-primary" /> : <StoreIcon className="size-[18px] shrink-0 text-sidebar-primary" />}
        <span className="truncate">{mode === "org" ? orgName : store?.name ?? "Store"}</span>
      </p>
      {mode === "store" && store && <p className="ml-6 mt-1 text-[15px] text-sidebar-muted">{store.code}</p>}
      {mode === "store" && canLeaveToOrg && (
        <Link href="/org" className="mt-3 flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[15px] font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-overlay"><ArrowLeft className="size-4" /> Back to organisation</Link>
      )}
    </div>
  );
}

function SidebarNav({ collapsed, onNavigate, onExpand }: { collapsed: boolean; onNavigate?: () => void; onExpand?: () => void }) {
  const pathname = usePathname();
  const { storeId, mode } = useShell();
  const me = useMe();
  const sections = visibleNav(me, storeId, mode);
  const groups = sections.flatMap((section) => groupNavItems(section.items).map((group) => ({ ...group, id: `${section.id}-${group.id}` })));
  const [collapsedGroupIds, setCollapsedGroupIds] = React.useState<Set<string>>(() => new Set());

  return (
    <nav aria-label={mode === "org" ? "Organisation navigation" : "Store navigation"} className="sidebar-scroll flex-1 overflow-y-auto px-2.5 py-4">
      {sections.length === 0 && !collapsed && <p className="px-2 text-sm text-sidebar-muted">No pages are available to your account in this area.</p>}
      <ul className="space-y-1">
        {groups.map((group) => {
          const active = group.items.some((item) => isNavItemActive(pathname, item, storeId));
          const firstItem = group.items[0];
          if (!firstItem) return null;
          if (!group.title) {
            const href = resolveHref(firstItem.href, storeId);
            return <li key={group.id}><Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
              className={cn("relative flex h-12 items-center gap-3 rounded-lg px-3 text-[17px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-overlay", active && "bg-sidebar-accent font-semibold text-sidebar-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary", collapsed && "justify-center px-0")}>
              <firstItem.icon className="size-5 shrink-0" />{!collapsed && <span className="truncate">{firstItem.label}</span>}{collapsed && <span className="sr-only">{firstItem.label}</span>}
            </Link></li>;
          }

          if (collapsed) return <li key={group.id}><button type="button" title={`${group.title} · expand sidebar`} aria-label={`Expand sidebar to open ${group.title}`} onClick={() => { setCollapsedGroupIds((current) => { const next = new Set(current); next.delete(group.id); return next; }); onExpand?.(); }}
            className={cn("relative flex h-12 w-full items-center justify-center rounded-lg text-sidebar-foreground transition-colors hover:bg-sidebar-overlay", active && "bg-sidebar-accent text-sidebar-foreground")}>
            <firstItem.icon className="size-5" />
          </button></li>;

          const open = isNavGroupOpen(group.id, collapsedGroupIds);
          const listId = `nav-${group.id.replace(/[^a-z0-9-]/gi, "-")}`;
          return <li key={group.id} className="pt-1">
            <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setCollapsedGroupIds((current) => toggleNavGroup(group.id, current))}
              className={cn("flex min-h-11 w-full items-center justify-between rounded-lg px-2.5 text-left text-sm font-semibold uppercase tracking-[0.1em] text-sidebar-muted transition-colors hover:bg-sidebar-overlay hover:text-sidebar-foreground", active && "text-sidebar-primary")}>
              <span className="truncate">{group.title}</span><ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform", !open && "-rotate-90")} />
            </button>
            <ul id={listId} aria-hidden={!open} hidden={!open} className={cn("ml-2 grid gap-1 border-l border-sidebar-border pb-1 pl-2 pt-1", !open && "hidden")}>
              {group.items.map((item) => {
                const href = resolveHref(item.href, storeId);
                const itemActive = isNavItemActive(pathname, item, storeId);
                return <li key={item.href}><Link href={href} onClick={onNavigate} aria-current={itemActive ? "page" : undefined}
                  className={cn("relative flex h-12 items-center gap-3 rounded-lg px-3 text-[17px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-overlay", itemActive && "bg-sidebar-accent font-semibold text-sidebar-foreground before:absolute before:inset-y-2 before:left-[-0.55rem] before:w-[3px] before:rounded-full before:bg-sidebar-primary")}>
                  <item.icon className="size-[18px] shrink-0" /><span className="truncate">{item.label}</span>
                </Link></li>;
              })}
            </ul>
          </li>;
        })}
      </ul>
    </nav>
  );
}

function Brand({ collapsed, home }: { collapsed: boolean; home: string }) {
  return (
    <Link href={home} aria-label="DeltCRM POS home" className={cn("flex h-[4.5rem] items-center gap-3 border-b border-sidebar-border-soft px-5 text-sidebar-foreground", collapsed && "justify-center px-0")}>
      <BrandMark size="compact" className="bg-sidebar-accent text-sidebar-primary ring-sidebar-border" />
      {!collapsed && <span className="inline-flex items-center gap-2"><span className="font-sans text-lg font-bold tracking-tight">DeltCRM</span><span className="rounded-md border border-sidebar-border-soft bg-sidebar-overlay px-2 py-1 text-[11px] font-bold leading-none tracking-[0.08em] text-sidebar-primary">POS</span></span>}
    </Link>
  );
}

/** In org context this is "Open a store"; in store context it switches between the user's own stores. */
function StoreSwitcher() {
  const { stores, storeId, mode } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const current = stores.find((s) => s.id === storeId) ?? stores[0];
  const go = (id: string) => {
    if (mode === "org") { router.push(`/s/${id}`); return; }
    // Keep the user on the same page type when switching store; the URL is the source of truth.
    const m = pathname.match(/^\/s\/[^/]+(\/[^/]+)?/);
    router.push(`/s/${id}${m?.[1] && m[1] !== "/pos" ? m[1] : ""}`);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="max-w-56 justify-between" aria-label={mode === "org" ? "Open a store" : "Switch store"}>
          <StoreIcon /><span className="truncate">{mode === "org" ? "Open a store" : current?.name ?? "Select store"}</span>{mode === "store" && current && <span className="text-xs font-normal text-muted-foreground">· {current.code}</span>}<ChevronsUpDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{mode === "org" ? "Open a store to see its operations" : "Your stores"}</DropdownMenuLabel>
        {stores.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => go(s.id)}>
            <span className="flex-1 truncate">{s.name}</span><span className="text-xs text-muted-foreground">{s.code}</span>
            {mode === "store" && s.id === storeId && <Check />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommandMenu({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  const { stores, storeId, orgName } = useShell();
  const me = useMe();
  const nav = visibleNav(me, storeId);
  const storeName = stores.find((s) => s.id === storeId)?.name ?? "Store";
  const canOpenStores = hasOrgScope(me) || stores.length > 1;
  const run = (href: string) => { setOpen(false); router.push(href); };
  const heading = "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-24 max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <Command label="Command menu" className="flex flex-col">
          <Command.Input autoFocus placeholder="Go to a page or open a store…" className="h-12 border-b bg-transparent px-4 text-base outline-none" />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-base text-muted-foreground">No results.</Command.Empty>
            {nav.map((section) => (
              <Command.Group key={section.id} heading={section.id === "org" ? `Organisation · ${orgName}` : `Store · ${storeName}`} className={heading}>
                {section.items.map((item) => (
                  <Command.Item key={item.href} value={`${section.title} ${item.label} ${item.keywords?.join(" ") ?? ""}`} onSelect={() => run(resolveHref(item.href, storeId))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2.5 text-base data-[selected=true]:bg-accent"><item.icon className="size-4" />{item.label}</Command.Item>
                ))}
              </Command.Group>
            ))}
            {canOpenStores && (
              <Command.Group heading="Open a store" className={heading}>
                {stores.map((s) => (
                  <Command.Item key={s.id} value={`open store ${s.name} ${s.code}`} onSelect={() => run(`/s/${s.id}`)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2.5 text-base data-[selected=true]:bg-accent"><StoreIcon className="size-4" />{s.name}<span className="ml-auto text-sm text-muted-foreground">{s.code}</span></Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function ThemeToggle() {
  // The initial theme is applied by a script in the root layout; the icon follows the `dark` class via CSS.
  const toggle = () => {
    const d = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("pos-theme", d ? "dark" : "light"); } catch { /* storage unavailable */ }
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      <Moon className="dark:hidden" /><Sun className="hidden dark:block" />
    </Button>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { setPaletteOpen, storeId, stores, orgName, mode } = useShell();
  const me = useMe();
  const store = stores.find((s) => s.id === storeId);
  const canPickStore = mode === "org" ? hasOrgScope(me) && stores.length > 0 : stores.length > 1;
  return (
    <header className={cn("sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card px-3 sm:px-5")}>
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu /></Button>
      {mode === "store" && <span className="hidden items-center gap-1.5 text-sm font-semibold sm:flex"><Building2 className="size-4 text-muted-foreground" />{orgName}</span>}
      <span className="hidden h-5 w-px bg-border sm:block" />
      {mode === "org" ? (
        <>
          <span className="hidden rounded-lg border border-primary/20 bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground md:inline">Organisation-wide</span>
          {canPickStore && <StoreSwitcher />}
        </>
      ) : canPickStore ? (
        <StoreSwitcher />
      ) : (
        <span className="flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground"><StoreIcon className="size-3.5" />{store?.name ?? "Store"}<span className="font-normal opacity-70">· {store?.code}</span></span>
      )}
      <Button variant="outline" className="ml-auto hidden h-11 w-64 justify-between text-base text-muted-foreground sm:inline-flex" onClick={() => setPaletteOpen(true)}>
        <span className="flex items-center gap-2"><Search /> Search…</span><kbd className="rounded border bg-muted px-1.5 py-0.5 text-sm">Ctrl K</kbd>
      </Button>
      <Button variant="ghost" size="icon" className="ml-auto sm:hidden" onClick={() => setPaletteOpen(true)} aria-label="Open command menu"><Search /></Button>
      <ThemeToggle />
      {mode === "store" && storeId && <Button variant="ghost" size="icon" aria-label={`Alerts for ${store?.name ?? "this store"}`} asChild><Link href={`/s/${storeId}/alerts`}><Bell /></Link></Button>}
      <UserMenu />
    </header>
  );
}

/** Shown to anyone who can also administer the organisation, so a store view is never mistaken for the organisation. */
function StoreContextBanner() {
  const { stores, storeId } = useShell();
  const me = useMe();
  const store = stores.find((s) => s.id === storeId);
  const readOnly = isOrganisationReadOnlyStoreView(me, storeId);
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-accent px-4 py-2 text-sm text-accent-foreground">
      <StoreIcon className="size-4" />
      <span>{readOnly ? <>Organisation view · <strong>{store?.name ?? "this store"}</strong> · Read-only. Store actions require a store-scoped role.</> : <>You are viewing <strong>{store?.name ?? "this store"}</strong>. Everything on these pages is for this store only.</>}</span>
      <Link href="/org" className="ml-auto inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"><ArrowLeft className="size-3.5" /> Back to organisation</Link>
    </div>
  );
}

export function AppShell({ stores, orgName, defaultStoreId, home, children }: { stores: ShellStore[]; orgName: string; defaultStoreId: string; home: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMe();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const storeId = activeStoreId(pathname, defaultStoreId);
  // Staff with only store access never see the empty organisation sidebar (e.g. on /account).
  const mode = navMode(pathname) === "org" && !hasOrgScope(me) ? "store" : navMode(pathname);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ShellContext.Provider value={{ stores, storeId, orgName, mode, setPaletteOpen }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
      <div className="flex min-h-dvh">
        <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex", collapsed ? "w-[4.5rem]" : "w-[17rem]")}>
          <Brand collapsed={collapsed} home={home} />
          <ContextCard collapsed={collapsed} />
          <SidebarNav collapsed={collapsed} onExpand={() => setCollapsed(false)} />
          <button onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="m-3 flex h-11 items-center justify-center rounded-xl text-sidebar-muted transition-colors hover:bg-sidebar-overlay hover:text-sidebar-foreground">
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </aside>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[min(20rem,90vw)] border-sidebar-border bg-sidebar p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand collapsed={false} home={home} />
            <ContextCard collapsed={false} />
            <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <IdleLock />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenu={() => setMobileOpen(true)} />
          {mode === "store" && hasOrgScope(me) && <StoreContextBanner />}
          <main id="main" className="mx-auto w-full max-w-[1680px] flex-1 p-5 sm:p-6 xl:p-8">{children}</main>
        </div>
      </div>
      <CommandMenu open={paletteOpen} setOpen={setPaletteOpen} />
    </ShellContext.Provider>
  );
}

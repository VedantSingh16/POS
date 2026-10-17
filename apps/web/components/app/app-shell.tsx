"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import { ArrowLeft, Bell, Building2, Check, ChevronsUpDown, Menu, Moon, Search, Store as StoreIcon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { groupNavItems, isNavItemActive, navMode, resolveHref, visibleNav, type NavMode } from "@/lib/nav";
import { hasOrgScope, isOrganisationReadOnlyStoreView } from "@/lib/permissions";
import { useMe } from "@/components/app/session-context";
import { IdleLock, UserMenu } from "@/components/app/user-menu";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/brand-mark";
import { LocaleSwitch } from "@/components/i18n/locale-switch";
import { useTranslate } from "@/components/i18n/localized-text";

export type ShellStore = { id: string; code: string; name: string };
type Ctx = { stores: ShellStore[]; storeId: string; orgName: string; mode: NavMode; setPaletteOpen: (v: boolean) => void };
const ShellContext = React.createContext<Ctx | null>(null);
const useShell = () => { const c = React.useContext(ShellContext); if (!c) throw new Error("AppShell missing"); return c; };

function activeStoreId(pathname: string, fallback: string) {
  const m = pathname.match(/^\/s\/([^/]+)/);
  return m ? m[1] : fallback;
}

/** Tells the user, in the sidebar itself, which area they are in and how to leave it. */
function ContextCard() {
  const { stores, storeId, orgName, mode } = useShell();
  const me = useMe();
  const store = stores.find((s) => s.id === storeId);
  const canLeaveToOrg = hasOrgScope(me);
  return (
    <div className="mx-3 mt-3 border-b border-sidebar-border-soft px-2 pb-4 text-sidebar-foreground">
      <p className="text-sm font-medium text-sidebar-muted"><LocalizedText value={mode === "org" ? "Organisation" : "Store workspace"} /></p>
      <p className="mt-1 flex items-center gap-2 truncate text-base font-semibold">
        {mode === "org" ? <Building2 className="size-[18px] shrink-0 text-sidebar-primary" /> : <StoreIcon className="size-[18px] shrink-0 text-sidebar-primary" />}
        <span className="truncate">{mode === "org" ? orgName : store?.name ?? <LocalizedText value={"Store"} />}</span>
      </p>
      {mode === "store" && store && <p className="ms-6 mt-0.5 text-xs text-sidebar-muted">{store.code}</p>}
      {mode === "store" && canLeaveToOrg && (
        <Link href="/org" className="mt-2 flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-overlay"><ArrowLeft className="size-4 rtl:rotate-180" /> <LocalizedText value={"Back to organisation"} /></Link>
      )}
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslate();
  const pathname = usePathname();
  const { storeId, mode } = useShell();
  const me = useMe();
  const sections = visibleNav(me, storeId, mode);
  const groups = sections.flatMap((section) => groupNavItems(section.items).map((group) => ({ ...group, id: `${section.id}-${group.id}` })));
  return (
    <nav aria-label={t(mode === "org" ? "Organisation navigation" : "Store navigation")} className="sidebar-scroll flex-1 overflow-y-auto px-3 py-3">
      {sections.length === 0 && <p className="px-2 text-sm text-sidebar-muted"><LocalizedText value={"No pages are available to your account in this area."} /></p>}
      <ul className="space-y-1.5">
        {groups.map((group) => {
          const active = group.items.some((item) => isNavItemActive(pathname, item, storeId));
          const firstItem = group.items[0];
          if (!firstItem) return null;
          if (!group.title) {
            const href = resolveHref(firstItem.href, storeId);
            return <li key={group.id}><Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
              className={cn("relative flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-overlay", active && "bg-sidebar-accent font-semibold text-sidebar-active")}>
              <firstItem.icon className={cn("size-[19px] shrink-0", active ? "text-sidebar-active" : "text-sidebar-muted")} /><span className="truncate"><LocalizedText value={firstItem.label} /></span>
            </Link></li>;
          }

          return <li key={group.id} className="pt-4">
            <h2 className="flex min-h-8 items-center px-3 text-sm font-semibold text-sidebar-heading-foreground"><LocalizedText value={group.title} /></h2>
            <ul className="grid gap-1 pb-1 pt-1">
              {group.items.map((item) => {
                const href = resolveHref(item.href, storeId);
                const itemActive = isNavItemActive(pathname, item, storeId);
                return <li key={item.href}><Link href={href} onClick={onNavigate} aria-current={itemActive ? "page" : undefined}
                  className={cn("relative flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-overlay", itemActive && "bg-sidebar-accent font-semibold text-sidebar-active")}>
                  <item.icon className={cn("size-[19px] shrink-0", itemActive ? "text-sidebar-active" : "text-sidebar-muted")} /><span className="truncate"><LocalizedText value={item.label} /></span>
                </Link></li>;
              })}
            </ul>
          </li>;
        })}
      </ul>
    </nav>
  );
}

function Brand({ home }: { home: string }) {
  const t = useTranslate();
  return (
    <Link href={home} aria-label={t("DeltPOS home")} className="flex h-[4.5rem] items-center gap-3 border-b border-sidebar-border-soft px-5 text-sidebar-foreground">
      <BrandMark size="compact" className="bg-transparent text-sidebar-foreground shadow-none ring-0" />
      <span className="inline-flex items-center gap-2"><span className="font-sans text-lg font-bold tracking-tight"><LocalizedText value={"DeltPOS"} /></span><span className="rounded-md border border-sidebar-border-soft bg-sidebar-surface px-1.5 py-0.5 text-xs font-bold leading-none tracking-[0.06em] text-sidebar-foreground"><LocalizedText value={"POS"} /></span></span>
    </Link>
  );
}

/** In org context this is "Open a store"; in store context it switches between the user's own stores. */
function StoreSwitcher() {
  const t = useTranslate();
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
        <Button variant="outline" className="max-w-56 justify-between" aria-label={t(mode === "org" ? "Open a store" : "Switch store")}>
          <StoreIcon /><span className="truncate">{mode === "org" ? <LocalizedText value={"Open a store"} /> : current?.name ?? <LocalizedText value={"Select store"} />}</span>{mode === "store" && current && <span className="text-xs font-normal text-muted-foreground">· {current.code}</span>}<ChevronsUpDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel><LocalizedText value={mode === "org" ? "Open a store to see its operations" : "Your stores"} /></DropdownMenuLabel>
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
  const t = useTranslate();
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
        <DialogTitle className="sr-only"><LocalizedText value={"Command menu"} /></DialogTitle>
        <Command label={t("Command menu")} className="flex flex-col">
          <Command.Input autoFocus placeholder={t("Go to a page or open a store…")} className="h-12 border-b bg-transparent px-4 text-base outline-none" />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-base text-muted-foreground"><LocalizedText value={"No results."} /></Command.Empty>
            {nav.map((section) => (
              <Command.Group key={section.id} heading={section.id === "org" ? `${t("Organisation")} · ${orgName}` : `${t("Store")} · ${storeName}`} className={heading}>
                {section.items.map((item) => (
                  <Command.Item key={item.href} value={`${section.title} ${item.label} ${item.keywords?.join(" ") ?? ""}`} onSelect={() => run(resolveHref(item.href, storeId))}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2.5 text-base data-[selected=true]:bg-accent"><item.icon className="size-4" /><LocalizedText value={item.label} /></Command.Item>
                ))}
              </Command.Group>
            ))}
            {canOpenStores && (
              <Command.Group heading={t("Open a store")} className={heading}>
                {stores.map((s) => (
                  <Command.Item key={s.id} value={`open store ${s.name} ${s.code}`} onSelect={() => run(`/s/${s.id}`)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2.5 text-base data-[selected=true]:bg-accent"><StoreIcon className="size-4" />{s.name}<span className="ms-auto text-sm text-muted-foreground">{s.code}</span></Command.Item>
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
  const t = useTranslate();
  // The initial theme is applied by a script in the root layout; the icon follows the `dark` class via CSS.
  const toggle = () => {
    const d = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("pos-theme", d ? "dark" : "light"); } catch { /* storage unavailable */ }
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={t("Toggle theme")}>
      <Moon className="dark:hidden" /><Sun className="hidden dark:block" />
    </Button>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const t = useTranslate();
  const { setPaletteOpen, storeId, stores, orgName, mode } = useShell();
  const me = useMe();
  const store = stores.find((s) => s.id === storeId);
  const canPickStore = mode === "org" ? hasOrgScope(me) && stores.length > 0 : stores.length > 1;
  return (
    <header className={cn("sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card px-3 sm:px-5")}>
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label={t("Open navigation")}><Menu /></Button>
      {mode === "store" && <span className="hidden items-center gap-1.5 text-sm font-semibold sm:flex"><Building2 className="size-4 text-muted-foreground" />{orgName}</span>}
      <span className="hidden h-5 w-px bg-border sm:block" />
      {mode === "org" ? (
        <>
          <span className="hidden px-2 py-2 text-sm font-semibold text-foreground md:inline"><LocalizedText value={"Organisation-wide"} /></span>
          {canPickStore && <StoreSwitcher />}
        </>
      ) : canPickStore ? (
        <StoreSwitcher />
      ) : (
        <span className="flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground"><StoreIcon className="size-3.5" />{store?.name ?? "Store"}<span className="font-normal opacity-70">· {store?.code}</span></span>
      )}
      <Button variant="outline" className="ms-auto hidden h-11 w-64 justify-between text-base text-muted-foreground sm:inline-flex" onClick={() => setPaletteOpen(true)}>
        <span className="flex items-center gap-2"><Search /> <LocalizedText value={"Search…"} /></span><kbd className="rounded border bg-muted px-1.5 py-0.5 text-sm"><LocalizedText value={"Ctrl K"} /></kbd>
      </Button>
      <Button variant="ghost" size="icon" className="ms-auto sm:hidden" onClick={() => setPaletteOpen(true)} aria-label={t("Open command menu")}><Search /></Button>
      <LocaleSwitch compact />
      <ThemeToggle />
      {mode === "store" && storeId && <Button variant="ghost" size="icon" aria-label={t("Alerts")} asChild><Link href={`/s/${storeId}/alerts`}><Bell /></Link></Button>}
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
      <span>{readOnly ? <><LocalizedText value={"Organisation view · "} /><strong>{store?.name ?? "this store"}</strong> <LocalizedText value={"· Read-only. Store actions require a store-scoped role."} /></> : <><LocalizedText value={"You are viewing "} /><strong>{store?.name ?? "this store"}</strong><LocalizedText value={". Everything on these pages is for this store only."} /></>}</span>
      <Link href="/org" className="ms-auto inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"><ArrowLeft className="size-3.5 rtl:rotate-180" /> <LocalizedText value={"Back to organisation"} /></Link>
    </div>
  );
}

export function AppShell({ stores, orgName, defaultStoreId, home, children }: { stores: ShellStore[]; orgName: string; defaultStoreId: string; home: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMe();
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
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"><LocalizedText value={"Skip to content"} /></a>
      <div className="app-ui flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar lg:flex rtl:border-e-0 rtl:border-s">
          <Brand home={home} />
          <ContextCard />
          <SidebarNav />
        </aside>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-[min(20rem,90vw)] border-sidebar-border bg-sidebar p-0 rtl:start-auto rtl:end-0">
            <SheetTitle className="sr-only"><LocalizedText value={"Navigation"} /></SheetTitle>
            <Brand home={home} />
            <ContextCard />
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <IdleLock />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenu={() => setMobileOpen(true)} />
          {mode === "store" && hasOrgScope(me) && <StoreContextBanner />}
          <main id="main" className="mx-auto w-full max-w-[1680px] flex-1 p-5 sm:p-7 xl:p-10">{children}</main>
        </div>
      </div>
      <CommandMenu open={paletteOpen} setOpen={setPaletteOpen} />
    </ShellContext.Provider>
  );
}

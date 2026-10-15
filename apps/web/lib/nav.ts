import { hasOrgScope, hasPermission, type Me } from "@/lib/permissions";
import {
  LayoutDashboard, Users, ShieldCheck, Store, Package, FolderTree, Percent, UserRound, BarChart3, Settings, SlidersHorizontal,
  ScrollText, ArrowLeftRight, CircleDollarSign, Receipt, Undo2, Boxes, Landmark, CheckCheck, Bell, ShoppingCart, Tags, type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  /** `:storeId` is replaced with the active store. */
  href: string;
  icon: LucideIcon;
  /** Permission code that gates visibility. The API enforces the same rule on every call. */
  permission?: string;
  keywords?: string[];
  /** Additional routes whose active state belongs to this navigation item. */
  activePaths?: string[];
  /** Collapsible area in the sidebar; related destinations stay together. */
  group?: string;
};
export type NavSection = { id: "org" | "store"; title: string; items: NavItem[] };
export type NavMode = "org" | "store";
export type NavGroup = { id: string; title?: string; items: NavItem[] };

/** Groups adjacent navigation destinations without changing their route or permission rules. */
export function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (item.group && last?.title === item.group) last.items.push(item);
    else groups.push({ id: item.group ? `${item.group}-${groups.length}` : item.href, title: item.group, items: [item] });
  }
  return groups;
}

/** Returns the collapsible group containing the current destination, including nested setup routes. */
export function findActiveNavGroup(pathname: string, groups: NavGroup[], storeId: string) {
  return groups.find((group) => group.title && group.items.some((item) => isNavItemActive(pathname, item, storeId))) ?? null;
}

/**
 * Two separate areas, never shown together:
 *  - org   → organisation administration (stores, people, catalogue, organisation-wide reports)
 *  - store → one store's operations (selling, stock, tills, store reports)
 */
export const NAV: NavSection[] = [
  {
    id: "org",
    title: "Organisation",
    items: [
      { label: "Overview", href: "/org", icon: LayoutDashboard },
      { label: "Stores", href: "/org/stores", icon: Store, permission: "stores.view", group: "Locations & stock", keywords: ["locations", "branches"] },
      { label: "Stock transfers", href: "/org/transfers", icon: ArrowLeftRight, permission: "transfer.manage", group: "Locations & stock", keywords: ["move stock", "transfer"] },
      { label: "Distributions", href: "/org/distributions", icon: ArrowLeftRight, permission: "catalog.distribute", group: "Locations & stock", keywords: ["push stock", "distribute", "allocation"] },
      { label: "Team members", href: "/org/users", icon: Users, permission: "users.view", group: "People & access", keywords: ["users", "staff", "managers"] },
      { label: "Roles & access", href: "/org/roles", icon: ShieldCheck, permission: "roles.view", group: "People & access", keywords: ["permissions"] },
      { label: "Product catalogue", href: "/org/catalog/products", icon: Package, permission: "catalog.view", group: "Catalogue", keywords: ["products", "items"], activePaths: ["/org/catalog/import"] },
      { label: "Categories", href: "/org/catalog/categories", icon: FolderTree, permission: "catalog.view", group: "Catalogue" },
      { label: "Catalogue setup", href: "/org/catalog/setup", icon: SlidersHorizontal, permission: "catalog.view", group: "Catalogue", keywords: ["types", "fields", "brands", "units", "configuration"], activePaths: ["/org/catalog/types", "/org/catalog/fields", "/org/catalog/brands", "/org/catalog/units"] },
      { label: "Customers", href: "/org/customers", icon: UserRound, permission: "customer.view", group: "Customers & insights" },
      { label: "Reports & analytics", href: "/org/reports", icon: BarChart3, permission: "report.view", group: "Customers & insights", keywords: ["sales", "gst", "compare"] },
      { label: "Organisation settings", href: "/org/settings/general", icon: Settings, permission: "org.settings.manage", group: "Administration", activePaths: ["/org/settings"] },
      { label: "Audit log", href: "/org/audit", icon: ScrollText, permission: "audit.view", group: "Administration" },
    ],
  },
  {
    id: "store",
    title: "Store",
    items: [
      { label: "Store overview", href: "/s/:storeId", icon: LayoutDashboard, permission: "store.overview.view" },
      { label: "Point of sale", href: "/s/:storeId/pos", icon: ShoppingCart, permission: "sale.create", group: "Sales & reports", keywords: ["checkout", "till", "register"] },
      { label: "Sales", href: "/s/:storeId/sales", icon: Receipt, permission: "sale.view", group: "Sales & reports", keywords: ["receipts", "orders"] },
      { label: "Returns", href: "/s/:storeId/returns", icon: Undo2, permission: "refund.view", group: "Sales & reports", keywords: ["refund"] },
      { label: "Offers & price rules", href: "/s/:storeId/pricing", icon: Percent, permission: "pricing.view", group: "Sales & reports", keywords: ["discounts", "coupons", "offers"] },
      { label: "Store reports", href: "/s/:storeId/reports", icon: BarChart3, permission: "report.view", group: "Sales & reports" },
      { label: "Inventory", href: "/s/:storeId/inventory", icon: Boxes, permission: "inventory.view", group: "Stock", keywords: ["stock"] },
      { label: "Products", href: "/s/:storeId/products", icon: Package, permission: "catalog.view", group: "Stock", keywords: ["catalogue", "items"] },
      { label: "Categories", href: "/s/:storeId/categories", icon: FolderTree, permission: "catalog.view", group: "Stock" },
      { label: "Brands", href: "/s/:storeId/brands", icon: Tags, permission: "catalog.view", group: "Stock", keywords: ["product taxonomy"] },
      { label: "Registers", href: "/s/:storeId/registers", icon: Landmark, permission: "registers.view", group: "Store operations", keywords: ["cash", "shift", "till"] },
      { label: "Approvals", href: "/s/:storeId/approvals", icon: CheckCheck, permission: "approval.manage", group: "Store operations" },
      { label: "Alerts", href: "/s/:storeId/alerts", icon: Bell, permission: "report.view", group: "Store operations" },
      { label: "Staff", href: "/s/:storeId/staff", icon: Users, permission: "store.staff.view", group: "Store operations" },
      { label: "Store settings", href: "/s/:storeId/settings/profile", icon: Settings, permission: "store.settings.view", group: "Settings" },
      { label: "Billing & checkout", href: "/s/:storeId/settings/billing", icon: Receipt, permission: "store.settings.view", group: "Settings", keywords: ["billing", "checkout", "payment methods", "discounts", "receipt"], activePaths: ["/s/:storeId/settings/checkout"] },
      { label: "Tax groups & charges", href: "/s/:storeId/settings/tax", icon: CircleDollarSign, permission: "tax.view", group: "Settings", keywords: ["gst", "service charge"] },
    ],
  },
];

/** `/s/...` is the store area; everything else (org pages, onboarding, errors) is organisation context. */
export const navMode = (pathname: string): NavMode => (pathname.startsWith("/s/") ? "store" : "org");

export const resolveHref = (href: string, storeId: string) => href.replace(":storeId", storeId);

/** Keeps a navigation destination highlighted on its related detail and setup routes. */
export function isNavItemActive(pathname: string, item: NavItem, storeId: string) {
  return [item.href, ...(item.activePaths ?? [])].some((path) => {
    const href = resolveHref(path, storeId);
    if (href === "/org" || /^\/s\/[^/]+$/.test(href)) return pathname === href;
    return pathname === href || (href.split("/").length > 2 && pathname.startsWith(href + "/"));
  });
}

/** Labels for breadcrumb segments. */
export const SEGMENT_LABELS: Record<string, string> = {
  org: "Organisation", s: "Stores", users: "Users", roles: "Roles", stores: "Stores", catalog: "Catalogue",
  products: "Products", categories: "Categories", brands: "Brands", tax: "Tax groups", customers: "Customers",
  reports: "Reports", settings: "Settings", general: "General", receipts: "Billing & checkout", billing: "Billing & checkout", profile: "Store profile", approvals: "Approvals",
  security: "Security", audit: "Audit log", sales: "Sales", returns: "Returns", inventory: "Inventory",
  ledger: "Ledger", adjust: "Adjust stock", registers: "Registers", alerts: "Alerts", staff: "Staff",
  import: "Import", fields: "Product fields", charges: "Additional charges", pricing: "Tax & charges", new: "New", pos: "Point of sale", units: "Units", transfers: "Stock transfers", distributions: "Distributions", account: "My account",
};


/**
 * Navigation the user is allowed to see. Org items need an organisation-wide grant; store items are checked against the active store.
 * Pass `mode` to get only the area the user is currently working in.
 */
export function visibleNav(me: Me, storeId: string, mode?: NavMode): NavSection[] {
  return NAV.flatMap((section) => {
    if (mode && section.id !== mode) return [];
    if (section.id === "org" && !hasOrgScope(me)) return [];
    if (section.id === "store" && !me.stores.some((s) => s.id === storeId)) return [];
    const items = section.items.filter((item) => !item.permission || hasPermission(me, item.permission, section.id === "store" ? storeId : undefined));
    return items.length ? [{ ...section, items }] : [];
  });
}

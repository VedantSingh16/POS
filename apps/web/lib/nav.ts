import { hasOrgScope, hasPermission, type Me } from "@/lib/permissions";
import {
  LayoutDashboard, Users, ShieldCheck, Store, Package, Tags, FolderTree, Percent, UserRound, BarChart3, Settings,
  ScrollText, ArrowLeftRight, CircleDollarSign, Ruler, Receipt, Undo2, Boxes, Landmark, CheckCheck, Bell, ShoppingCart, type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  /** `:storeId` is replaced with the active store. */
  href: string;
  icon: LucideIcon;
  /** Permission code that gates visibility. The API enforces the same rule on every call. */
  permission?: string;
  keywords?: string[];
  /** Heading shown above a run of related items in the sidebar. */
  group?: string;
};
export type NavSection = { id: "org" | "store"; title: string; items: NavItem[] };
export type NavMode = "org" | "store";

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
      { label: "Stores", href: "/org/stores", icon: Store, permission: "stores.view", group: "Stores & team", keywords: ["locations", "branches"] },
      { label: "Team members", href: "/org/users", icon: Users, permission: "users.view", group: "Stores & team", keywords: ["users", "staff", "managers"] },
      { label: "Stock transfers", href: "/org/transfers", icon: ArrowLeftRight, permission: "transfer.manage", group: "Stores & team", keywords: ["move stock", "transfer"] },
      { label: "Distributions", href: "/org/distributions", icon: ArrowLeftRight, permission: "catalog.distribute", group: "Stores & team", keywords: ["push stock", "distribute", "allocation"] },
      { label: "Roles & access", href: "/org/roles", icon: ShieldCheck, permission: "roles.view", group: "Stores & team", keywords: ["permissions"] },
      { label: "Products", href: "/org/catalog/products", icon: Package, permission: "catalog.view", group: "Product catalogue", keywords: ["catalogue", "items"] },
      { label: "Categories", href: "/org/catalog/categories", icon: FolderTree, permission: "catalog.view", group: "Product catalogue" },
      { label: "Brands", href: "/org/catalog/brands", icon: Tags, permission: "catalog.view", group: "Product catalogue" },
      { label: "Tax groups", href: "/org/catalog/tax", icon: Percent, permission: "catalog.view", group: "Product catalogue", keywords: ["gst"] },
      { label: "Additional charges", href: "/org/catalog/charges", icon: CircleDollarSign, permission: "pricing.view", group: "Product catalogue", keywords: ["packaging", "service charge", "fees"] },
      { label: "Units", href: "/org/catalog/units", icon: Ruler, permission: "catalog.view", group: "Product catalogue", keywords: ["uom", "measure"] },
      { label: "Customers", href: "/org/customers", icon: UserRound, permission: "customer.view", group: "Customers & insights" },
      { label: "Reports & analytics", href: "/org/reports", icon: BarChart3, permission: "report.view", group: "Customers & insights", keywords: ["sales", "gst", "compare"] },
      { label: "Organisation settings", href: "/org/settings/general", icon: Settings, permission: "org.settings.manage", group: "Administration" },
      { label: "Audit log", href: "/org/audit", icon: ScrollText, permission: "audit.view", group: "Administration" },
    ],
  },
  {
    id: "store",
    title: "Store",
    items: [
      { label: "Store overview", href: "/s/:storeId", icon: LayoutDashboard, permission: "store.overview.view" },
      { label: "Point of sale", href: "/s/:storeId/pos", icon: ShoppingCart, permission: "sale.create", group: "Selling", keywords: ["checkout", "till", "register"] },
      { label: "Sales", href: "/s/:storeId/sales", icon: Receipt, permission: "sale.create", group: "Selling", keywords: ["receipts", "orders"] },
      { label: "Returns", href: "/s/:storeId/returns", icon: Undo2, permission: "refund.create", group: "Selling", keywords: ["refund"] },
      { label: "Inventory", href: "/s/:storeId/inventory", icon: Boxes, permission: "inventory.view", group: "Stock", keywords: ["stock"] },
      { label: "Products", href: "/s/:storeId/products", icon: Package, permission: "catalog.view", group: "Stock", keywords: ["catalogue", "items"] },
      { label: "Categories", href: "/s/:storeId/categories", icon: FolderTree, permission: "catalog.view", group: "Stock" },
      { label: "Brands", href: "/s/:storeId/brands", icon: Tags, permission: "catalog.view", group: "Stock" },
      { label: "Tax & charges", href: "/s/:storeId/pricing", icon: CircleDollarSign, permission: "pricing.view", group: "Stock", keywords: ["gst", "packaging", "service charge"] },
      { label: "Registers", href: "/s/:storeId/registers", icon: Landmark, permission: "registers.view", group: "Tills & control", keywords: ["cash", "shift", "till"] },
      { label: "Approvals", href: "/s/:storeId/approvals", icon: CheckCheck, permission: "approval.manage", group: "Tills & control" },
      { label: "Alerts", href: "/s/:storeId/alerts", icon: Bell, permission: "report.view", group: "Tills & control" },
      { label: "Staff", href: "/s/:storeId/staff", icon: Users, permission: "store.staff.view", group: "Store admin" },
      { label: "Store reports", href: "/s/:storeId/reports", icon: BarChart3, permission: "report.view", group: "Store admin" },
      { label: "Store settings", href: "/s/:storeId/settings", icon: Settings, permission: "store.settings.view", group: "Store admin" },
    ],
  },
];

/** `/s/...` is the store area; everything else (org pages, onboarding, errors) is organisation context. */
export const navMode = (pathname: string): NavMode => (pathname.startsWith("/s/") ? "store" : "org");

export const resolveHref = (href: string, storeId: string) => href.replace(":storeId", storeId);

/** Labels for breadcrumb segments. */
export const SEGMENT_LABELS: Record<string, string> = {
  org: "Organisation", s: "Stores", users: "Users", roles: "Roles", stores: "Stores", catalog: "Catalogue",
  products: "Products", categories: "Categories", brands: "Brands", tax: "Tax groups", customers: "Customers",
  reports: "Reports", settings: "Settings", general: "General", receipts: "Receipts", approvals: "Approvals",
  security: "Security", audit: "Audit log", sales: "Sales", returns: "Returns", inventory: "Inventory",
  ledger: "Ledger", adjust: "Adjust stock", registers: "Registers", alerts: "Alerts", staff: "Staff",
  import: "Import", charges: "Additional charges", pricing: "Tax & charges", new: "New", pos: "Point of sale", units: "Units", transfers: "Stock transfers", distributions: "Distributions", account: "My account",
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

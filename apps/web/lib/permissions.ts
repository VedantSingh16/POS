import { STORE_READ_ONLY_PERMISSION_CODES } from "@pos/shared/permissions";

// Pure permission helpers shared by server and client code. The API enforces every rule again; this only decides what to show and where to land.
export type Me = {
  user: { userId: string; email: string; displayName: string; defaultStoreId: string | null; isOrganisationAdministrator: boolean };
  hasPin: boolean;
  /** Minutes of inactivity before a till with a PIN locks; set under Settings → Security. */
  idleLockMinutes?: number;
  onboardingRequired?: boolean;
  organisation: { id: string; name: string; slug: string; currency?: string; countryCode?: string; taxProfileStatus?: string };
  roles: { name: string; scopeType: "ORGANIZATION" | "STORE"; storeId: string | null }[];
  permissions: { organization: string[]; stores: Record<string, string[]> };
  stores: { id: string; code: string; name: string }[];
};

export function hasPermission(me: Me, code: string, storeId?: string): boolean {
  if (storeId) {
    return Boolean(me.permissions.stores[storeId]?.includes(code));
  }
  return me.permissions.organization.includes(code);
}

/** Organization administrators are read-only in a store unless a store-scoped role grants an operation. */
export function isOrganisationReadOnlyStoreView(me: Me, storeId: string): boolean {
  if (!me.user.isOrganisationAdministrator) return false;
  const readOnly = new Set<string>(STORE_READ_ONLY_PERMISSION_CODES);
  return !(me.permissions.stores[storeId] ?? []).some((code) => !readOnly.has(code));
}

/** True when the user holds any organisation-wide permission, i.e. may see the organisation area. */
export function hasOrgScope(me: Me): boolean {
  return me.permissions.organization.length > 0;
}

export function canAccessStore(me: Me, storeId: string): boolean {
  return me.stores.some((s) => s.id === storeId);
}

/** Where a user lands after sign-in: org admins → /org, cashiers → POS, everyone else → their store dashboard. */
export function landingPath(me: Me): string {
  if (me.onboardingRequired && me.user.isOrganisationAdministrator) return "/onboarding/welcome";
  if (hasOrgScope(me) && hasPermission(me, "org.overview.view")) return "/org";
  const store = me.stores.find((s) => s.id === me.user.defaultStoreId) ?? me.stores[0];
  if (!store) return hasOrgScope(me) ? "/org" : "/forbidden";
  const perms = me.permissions.stores[store.id] ?? [];
  const managerial = perms.some((p) => ["report.view", "registers.manage", "inventory.manage", "store.overview.view"].includes(p));
  if (perms.includes("sale.create") && !managerial) return `/s/${store.id}/pos`;
  if (perms.includes("store.overview.view")) return `/s/${store.id}`;
  if (perms.includes("inventory.view")) return `/s/${store.id}/inventory`;
  if (perms.includes("registers.view")) return `/s/${store.id}/registers`;
  if (perms.includes("catalog.view")) return `/s/${store.id}/products`;
  if (perms.includes("report.view")) return `/s/${store.id}/reports`;
  if (perms.includes("store.staff.view")) return `/s/${store.id}/staff`;
  if (perms.includes("store.settings.view")) return `/s/${store.id}/settings`;
  return "/forbidden";
}

/** Only same-site relative paths are honoured after sign-in. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

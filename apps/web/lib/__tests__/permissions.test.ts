import { describe, expect, it } from "vitest";
import { canAccessStore, hasOrgScope, hasPermission, isOrganisationReadOnlyStoreView, landingPath, safeNext, type Me } from "../permissions";
import { groupNavItems, isNavItemActive, NAV, navMode, visibleNav } from "../nav";

const A = "store-a";
const B = "store-b";
const base = { hasPin: false, organisation: { id: "o", name: "Org", slug: "org" } };
const user = (over: Partial<Me["user"]> = {}) => ({ userId: "u", email: "u@x", displayName: "U", defaultStoreId: A, isOrganisationAdministrator: false, ...over });
const stores = [{ id: A, code: "A", name: "Store A" }, { id: B, code: "B", name: "Store B" }];

const admin: Me = { ...base, user: user({ isOrganisationAdministrator: true }), roles: [], stores, permissions: { organization: ["org.overview.view", "users.view", "sale.create", "catalog.view"], stores: { [A]: ["store.overview.view", "store.settings.view", "store.staff.view", "registers.view", "catalog.view", "pricing.view", "report.view", "inventory.view", "sale.view", "refund.view", "customer.view"], [B]: ["store.overview.view", "catalog.view", "sale.view", "refund.view", "report.view"] } } };
const manager: Me = { ...base, user: user(), roles: [], stores: [stores[0]], permissions: { organization: [], stores: { [A]: ["store.overview.view", "store.settings.view", "store.settings.manage", "store.staff.view", "catalog.view", "report.view", "sale.view", "sale.create", "refund.view", "registers.view"] } } };
const cashier: Me = { ...base, user: user(), roles: [], stores: [stores[0]], permissions: { organization: [], stores: { [A]: ["sale.view", "sale.create", "registers.view", "catalog.view"] } } };
const inventory: Me = { ...base, user: user(), roles: [], stores: [stores[0]], permissions: { organization: [], stores: { [A]: ["catalog.view", "inventory.view"] } } };

describe("permissions", () => {
  it("organisation grants do not become store mutations; store grants stay scoped", () => {
    expect(hasPermission(admin, "sale.create", B)).toBe(false);
    expect(hasPermission(admin, "catalog.view", B)).toBe(true);
    expect(hasPermission(cashier, "sale.create", A)).toBe(true);
    expect(hasPermission(cashier, "sale.create", B)).toBe(false);
    expect(hasPermission(cashier, "sale.create")).toBe(false);
  });
  it("uses effective store grants when an organisation grant is denied for one store", () => {
    const scoped: Me = { ...base, user: user(), roles: [], stores, permissions: { organization: ["catalog.view"], stores: { [A]: [], [B]: ["catalog.view"] } } };
    expect(hasPermission(scoped, "catalog.view")).toBe(true);
    expect(hasPermission(scoped, "catalog.view", A)).toBe(false);
    expect(hasPermission(scoped, "catalog.view", B)).toBe(true);
  });
  it("only organisation-wide grants open the organisation area", () => {
    expect(hasOrgScope(admin)).toBe(true);
    expect(hasOrgScope(manager)).toBe(false);
  });
  it("store access follows the reachable store list", () => {
    expect(canAccessStore(cashier, A)).toBe(true);
    expect(canAccessStore(cashier, B)).toBe(false);
    expect(canAccessStore(admin, B)).toBe(true);
  });
  it("organization store access is read-only unless a store-scoped operation is present", () => {
    expect(isOrganisationReadOnlyStoreView(admin, A)).toBe(true);
    expect(hasPermission(admin, "sale.view", A)).toBe(true);
    expect(hasPermission(admin, "catalog.manage.store", A)).toBe(false);
    expect(hasPermission(admin, "store-catalog.verify", A)).toBe(false);
    const dualRole = { ...admin, permissions: { ...admin.permissions, stores: { ...admin.permissions.stores, [A]: [...admin.permissions.stores[A], "catalog.manage.store"] } } };
    expect(isOrganisationReadOnlyStoreView(dualRole, A)).toBe(false);
    expect(hasPermission(dualRole, "catalog.manage.store", A)).toBe(true);
  });
  it.each([
    ["admin", admin, "/org"],
    ["manager", manager, `/s/${A}`],
    ["cashier", cashier, `/s/${A}/pos`],
    ["inventory user", inventory, `/s/${A}/inventory`],
  ])("lands %s on the right page", (_n, me, expected) => expect(landingPath(me)).toBe(expected));
  it("routes a first-time organisation administrator into required onboarding", () => {
    expect(landingPath({ ...admin, onboardingRequired: true })).toBe("/onboarding/welcome");
  });
  it("a user with nothing is sent to /forbidden", () => {
    expect(landingPath({ ...cashier, stores: [], permissions: { organization: [], stores: {} } })).toBe("/forbidden");
  });
  it("navigation is filtered by role and store", () => {
    const labels = (me: Me, store: string) => visibleNav(me, store).flatMap((s) => s.items.map((i) => i.label));
    expect(labels(cashier, A)).toEqual(expect.arrayContaining(["Point of sale", "Registers"]));
    expect(labels(cashier, A)).not.toEqual(expect.arrayContaining(["Store overview", "Alerts"]));
    expect(labels(cashier, A)).not.toEqual(expect.arrayContaining(["Team members", "Roles & access", "Reports & analytics", "Audit log", "Inventory"]));
    expect(labels(cashier, B)).toEqual([]);
    expect(labels(admin, A)).toEqual(expect.arrayContaining(["Overview", "Team members", "Product catalogue", "Sales", "Returns"]));
    expect(labels(manager, A)).toEqual(expect.arrayContaining(["Store reports"]));
    expect(labels(manager, A)).toEqual(expect.arrayContaining(["Products", "Staff", "Store settings", "Billing & checkout"]));
    expect(labels(manager, A)).toContain("Brands");
    expect(labels(manager, A)).not.toEqual(expect.arrayContaining(["Team members", "Roles & access", "Stores", "Organisation settings"]));
    const settingsAdmin = { ...admin, permissions: { ...admin.permissions, organization: [...admin.permissions.organization, "org.settings.manage"] } };
    expect(labels(settingsAdmin, A)).toEqual(expect.arrayContaining(["Organisation settings", "Billing & checkout"]));
  });
  it("organisation and store navigation are never mixed in one view", () => {
    const labels = (me: Me, store: string, mode: "org" | "store") => visibleNav(me, store, mode).flatMap((s) => s.items.map((i) => i.label));
    const orgView = labels(admin, A, "org");
    const storeView = labels(admin, A, "store");
    expect(orgView).toEqual(expect.arrayContaining(["Overview", "Team members"]));
    expect(orgView).not.toEqual(expect.arrayContaining(["Point of sale", "Inventory", "Store reports"]));
    expect(storeView).not.toEqual(expect.arrayContaining(["Overview", "Team members", "Organisation settings", "Point of sale"]));
    // A store manager has no organisation area at all, in either mode.
    expect(labels(manager, A, "org")).toEqual([]);
    expect(labels(manager, A, "store")).toEqual(expect.arrayContaining(["Store reports", "Staff"]));
  });
  it("keeps related destinations together in a compact, ordered navigation", () => {
    const orgGroups = groupNavItems(NAV.find((section) => section.id === "org")!.items);
    const storeGroups = groupNavItems(NAV.find((section) => section.id === "store")!.items);
    expect(orgGroups.map((group) => group.title ?? group.items[0]?.label)).toEqual([
      "Overview", "Locations & stock", "People & access", "Catalogue", "Customers & reports", "Administration",
    ]);
    expect(storeGroups.map((group) => group.title ?? group.items[0]?.label)).toEqual([
      "Store overview", "Selling", "Stock", "Tills & control", "Team & reports", "Settings",
    ]);
    expect(storeGroups.find((group) => group.title === "Selling")?.items.map((item) => item.label)).toEqual([
      "Point of sale", "Sales", "Returns", "Offers & price rules",
    ]);
    expect(groupNavItems([NAV[0]!.items[0]!, NAV[1]!.items[0]!])).toHaveLength(2);
  });
  it("keeps catalogue and settings groups active on their nested routes", () => {
    const orgItems = NAV.find((section) => section.id === "org")!.items;
    const storeItems = NAV.find((section) => section.id === "store")!.items;
    expect(isNavItemActive("/org/catalog/brands", orgItems.find((item) => item.label === "Product catalogue")!, A)).toBe(true);
    expect(isNavItemActive("/org/settings/tax", orgItems.find((item) => item.label === "Organisation settings")!, A)).toBe(true);
    expect(isNavItemActive(`/s/${A}/brands`, storeItems.find((item) => item.label === "Brands")!, A)).toBe(true);
    expect(isNavItemActive(`/s/${A}/settings/checkout`, storeItems.find((item) => item.label === "Billing & checkout")!, A)).toBe(true);
    expect(isNavItemActive(`/s/${B}/settings/checkout`, storeItems.find((item) => item.label === "Billing & checkout")!, A)).toBe(false);
  });
  it("the URL decides the context", () => {
    expect(navMode("/org")).toBe("org");
    expect(navMode("/org/stores/abc")).toBe("org");
    expect(navMode("/onboarding/stores")).toBe("org");
    expect(navMode("/s/store-a")).toBe("store");
    expect(navMode("/s/store-a/inventory")).toBe("store");
  });
  it("only same-site relative redirects are honoured", () => {
    expect(safeNext("/org/users")).toBe("/org/users");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "", null, undefined]) expect(safeNext(bad as string)).toBeNull();
  });
});

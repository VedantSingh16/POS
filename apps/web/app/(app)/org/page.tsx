import { requirePermission } from "@/lib/server/session";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Store, Users } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { KpiTile, StatusBadge } from "@/components/data/primitives";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditTable } from "@/features/tables";
import { api } from "@/features/api";
import { hasPermission } from "@/lib/permissions";

export const metadata = { title: "Organisation overview" };

export default async function OrgOverview() {
  const me = await requirePermission("org.overview.view");
  const canCatalog = hasPermission(me, "catalog.view");
  const canTax = hasPermission(me, "tax.view");
  const [{ data: org }, { data: stores }, { data: users }, { data: audit }, { data: onboarding }, products] = await Promise.all([
    api.org(), api.stores(), api.users(), api.audit(), api.onboarding(),
    canCatalog ? api.products().then((r) => r.data) : Promise.resolve(null),
  ]);
  const activeStores = stores.filter((s) => s.status === "ACTIVE");
  const storeConfiguration = canTax && canCatalog
    ? await Promise.all(activeStores.map(async (store) => {
        const [catalogue, groups] = await Promise.all([
          api.storeCatalogue(store.id).catch(() => ({ data: [] })),
          api.storeTaxGroups(store.id).catch(() => ({ data: [] })),
        ]);
        return [store.id, { catalogue: catalogue.data, groups: groups.data }] as const;
      }))
    : [];
  const configurationByStore = new Map(storeConfiguration);
  const taxStatus = org.taxProfileStatus;
  const taxReviewed = ["REGISTERED", "NOT_REGISTERED", "LEGACY"].includes(taxStatus);
  const taxReadyForStore = (storeId: string) => {
    if (taxStatus !== "REGISTERED") return true;
    const configuration = configurationByStore.get(storeId);
    const activeGroups = new Set((configuration?.groups ?? []).filter((group) => group.status === "ACTIVE").map((group) => group.id));
    const activeItems = (configuration?.catalogue ?? []).filter((item) => item.assigned && item.status === "ACTIVE");
    return activeGroups.size > 0 && activeItems.every((item) => item.storeTaxGroupId !== null && activeGroups.has(item.storeTaxGroupId));
  };
  const ready = activeStores.filter((store) => {
    const activeItems = (configurationByStore.get(store.id)?.catalogue ?? []).filter((item) => item.assigned && item.status === "ACTIVE");
    return store.registers > 0 && activeItems.length > 0 && taxReadyForStore(store.id);
  });
  const onboardingDone = (onboarding.onboarding as { complete?: boolean } | undefined)?.complete === true;
  const checkoutReviewed = taxReviewed && activeStores.every((store) => taxReadyForStore(store.id));
  const checklist = [
    { label: "Organisation and first store created", done: onboardingDone && stores.length > 0, href: onboardingDone ? "/org/settings/general" : "/onboarding/organization" },
    ...(products ? [{ label: "Add your first product", done: products.length > 0, href: "/org/catalog/products" }] : []),
    { label: "Review store billing and tax settings", done: checkoutReviewed, href: activeStores[0] ? `/s/${activeStores[0].id}/settings/billing` : "/org/stores" },
    { label: "Invite your team (optional)", done: users.filter((user) => user.status === "ACTIVE").length > 1, href: "/org/users" },
  ];
  const done = checklist.filter((c) => c.done).length;
  return (
    <>
      <PageHeader title="Organisation overview" description={`Organisation-wide view for ${org.name}. Open a store to see its own operations.`} crumbs={[{ label: "Organisation" }, { label: "Overview" }]} />
      <div className="mb-5 grid grid-cols-2 rounded-md border-y bg-card px-4 py-3 sm:grid-cols-4">
        <KpiTile label="Active stores" value={`${activeStores.length} / ${org.maxStores}`} hint="Plan limit across the organisation" icon={Store} />
        <KpiTile label="Stores ready to sell" value={`${ready.length} / ${activeStores.length}`} hint="Register, product and tax setup ready" icon={CheckCircle2} tone={ready.length === activeStores.length && activeStores.length > 0 ? "success" : "warning"} />
        <KpiTile label="Active team members" value={users.filter((u) => u.status === "ACTIVE").length} hint={`${users.length} accounts in total`} icon={Users} />
        <KpiTile label="Needs attention" value={checklist.length - done} hint="Open setup items" icon={AlertTriangle} tone={checklist.length - done ? "warning" : "success"} />
      </div>
      <Card className="mb-4">
        <CardHeader><CardTitle>Your stores</CardTitle><Link href="/org/stores" className="text-xs text-primary hover:underline">Manage stores</Link></CardHeader>
        <CardContent>
          {stores.length === 0 ? <p className="text-sm text-muted-foreground">No stores yet. <Link href="/org/stores" className="font-medium text-primary hover:underline">Create the first store</Link>.</p> : (
            <ul className="divide-y">
              {stores.map((store) => (
                <li key={store.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/org/stores/${store.id}`} className="font-medium hover:underline">{store.name}</Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{store.code}</span>
                    <p className="text-xs text-muted-foreground">{store.city || "Address not set"} · {store.registers} register{store.registers === 1 ? "" : "s"} · {store.staff} staff</p>
                  </div>
                  {(store.registers === 0 || !ready.some((entry) => entry.id === store.id)) && <Badge tone="warning">Needs setup</Badge>}
                  <StatusBadge status={store.status} />
                  <Link href={`/s/${store.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open store <ArrowRight /></Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Setup checklist · {done} of {checklist.length}</CardTitle><Link href="/onboarding/optional" className="text-xs text-primary hover:underline">Optional setup</Link></CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="flex items-center gap-2 text-sm hover:underline">
                    {c.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                    <span className={c.done ? "text-muted-foreground line-through" : "font-medium"}>{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold">Recent organisation activity</h2>
          <AuditTable data={audit.slice(0, 8)} />
        </div>
      </div>
    </>
  );
}

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
      <div className="mb-6 grid grid-cols-2 rounded-2xl border border-border/80 bg-card px-4 py-4 shadow-surface sm:grid-cols-4 sm:px-5">
        <KpiTile label="Active stores" value={`${activeStores.length} / ${org.maxStores}`} hint="Plan limit across the organisation" icon={Store} />
        <KpiTile label="Stores ready to sell" value={`${ready.length} / ${activeStores.length}`} hint="Register, product and tax setup ready" icon={CheckCircle2} tone={ready.length === activeStores.length && activeStores.length > 0 ? "success" : "warning"} />
        <KpiTile label="Active team members" value={users.filter((u) => u.status === "ACTIVE").length} hint={`${users.length} accounts in total`} icon={Users} />
        <KpiTile label="Needs attention" value={checklist.length - done} hint="Open setup items" icon={AlertTriangle} tone={checklist.length - done ? "warning" : "success"} />
      </div>
      <Card className="mb-6 overflow-hidden rounded-2xl border-border/80 shadow-surface">
        <CardHeader className="px-5 py-4"><CardTitle className="font-display text-base font-bold tracking-[-0.025em]">Your stores</CardTitle><Link href="/org/stores" className="text-sm font-semibold text-primary hover:underline">Manage stores</Link></CardHeader>
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
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
        <Card className="overflow-hidden rounded-2xl border-border/80 shadow-surface">
          <CardHeader className="px-5 py-4"><CardTitle className="font-display text-base font-bold tracking-[-0.025em]">Setup progress <span className="ml-1 font-sans text-xs font-medium text-muted-foreground">{done} of {checklist.length}</span></CardTitle><Link href="/onboarding/optional" className="text-sm font-semibold text-primary hover:underline">Continue setup</Link></CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="group flex items-start gap-3 rounded-lg py-1 text-sm transition-colors hover:text-primary">
                    {c.done ? <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-success" /> : <Circle className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />}
                    <span className={c.done ? "leading-5 text-muted-foreground" : "leading-5 font-semibold group-hover:underline"}>{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 className="font-display text-base font-bold tracking-[-0.025em]">Recent activity</h2><p className="mt-1 text-sm text-muted-foreground">A short view of changes across your organisation.</p></div>
            <Link href="/org/audit" className="shrink-0 text-sm font-semibold text-primary hover:underline">View audit log</Link>
          </div>
          <AuditTable data={audit.slice(0, 4)} />
        </div>
      </div>
    </>
  );
}

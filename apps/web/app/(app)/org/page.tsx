import { getLocalizedPageTitle } from "@/lib/i18n/server";
import { LocalizedText } from "@/components/i18n/localized-text";
import { requirePermission } from "@/lib/server/session";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Store, Users } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { KpiTile, StatusBadge } from "@/components/data/primitives";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecentActivityList } from "@/features/tables";
import { api } from "@/features/api";
import { hasPermission } from "@/lib/permissions";

export async function generateMetadata() { return { title: await getLocalizedPageTitle("Organisation overview") }; }

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
  const openItems = checklist.filter((c) => !c.done);
  // One open item links straight to where it is fixed; several scroll to the checklist that lists them all.
  const attentionHref = openItems.length === 1 ? openItems[0].href : openItems.length > 1 ? "#setup-progress" : undefined;
  const attentionHint = openItems.length === 0 ? "Setup is complete" : `Next: ${openItems[0].label}`;
  return (
    <>
      <PageHeader title="Organisation overview" description={`Organisation-wide view for ${org.name}. Open a store to see its own operations.`} crumbs={[{ label: "Organisation" }, { label: "Overview" }]} />
      <div className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-card px-4 py-4 sm:grid-cols-4 sm:px-5">
        <KpiTile label="Active stores" value={`${activeStores.length} / ${org.maxStores}`} hint="Plan limit across the organisation" icon={Store} />
        <KpiTile label="Stores ready to sell" value={`${ready.length} / ${activeStores.length}`} hint="Register, product and tax setup ready" icon={CheckCircle2} tone={ready.length === activeStores.length && activeStores.length > 0 ? "success" : "warning"} />
        <KpiTile label="Active team members" value={users.filter((u) => u.status === "ACTIVE").length} hint={`${users.length} accounts in total`} icon={Users} />
        <KpiTile label="Needs attention" value={openItems.length} hint={attentionHint} icon={AlertTriangle} tone={openItems.length ? "warning" : "success"} href={attentionHref} linkLabel={openItems.length === 1 ? "Resolve now" : openItems.length > 1 ? `View ${openItems.length} open setup items` : undefined} />
      </div>
      <Card className="mb-6 overflow-hidden">
        <CardHeader><CardTitle><LocalizedText value={"Your stores"} /></CardTitle><Link href="/org/stores" className="text-sm font-semibold text-primary hover:underline"><LocalizedText value={"Manage stores"} /></Link></CardHeader>
        <CardContent>
          {stores.length === 0 ? <p className="text-sm text-muted-foreground"><LocalizedText value={"No stores yet. "} /><Link href="/org/stores" className="font-medium text-primary hover:underline"><LocalizedText value={"Create the first store"} /></Link>.</p> : (
            <ul className="divide-y">
              {stores.map((store) => (
                <li key={store.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/org/stores/${store.id}`} className="font-medium break-words hover:underline">{store.name}</Link>
                    <span className="ms-2 whitespace-nowrap font-mono text-xs text-muted-foreground">{store.code}</span>
                    <p className="mt-1 text-sm text-muted-foreground">{store.city || "Address not set"} · {store.registers} <LocalizedText value={"register"} /><LocalizedText value={store.registers === 1 ? "" : "s"} /> · {store.staff} <LocalizedText value={"staff"} /></p>
                  </div>
                  {(store.registers === 0 || !ready.some((entry) => entry.id === store.id)) && <Badge tone="warning"><LocalizedText value={"Needs setup"} /></Badge>}
                  <StatusBadge status={store.status} />
                  <Link href={`/s/${store.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}><LocalizedText value={"Open store "} /><ArrowRight className="rtl:rotate-180" /></Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)]">
        <Card id="setup-progress" className="scroll-mt-24 overflow-hidden">
          <CardHeader><CardTitle><LocalizedText value={"Setup progress "} /><span className="ms-1 font-sans text-sm font-medium text-muted-foreground">{done} <LocalizedText value={"of "} />{checklist.length}</span></CardTitle><Link href="/onboarding/optional" className="text-sm font-semibold text-primary hover:underline"><LocalizedText value={"Continue setup"} /></Link></CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="group flex min-h-11 items-start gap-3 rounded-lg py-2 text-base transition-colors hover:text-primary">
                    {c.done ? <CheckCircle2 className="mt-0.5 size-[18px] shrink-0 text-success" /> : <Circle className="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />}
                    <span className={c.done ? "leading-6 text-muted-foreground" : "leading-6 font-semibold group-hover:underline"}>{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold tracking-tight"><LocalizedText value={"Recent activity"} /></h2><p className="mt-1 text-sm text-muted-foreground"><LocalizedText value={"A short view of changes across your organisation."} /></p></div>
            <Link href="/org/audit" className="shrink-0 text-sm font-semibold text-primary hover:underline"><LocalizedText value={"View audit log"} /></Link>
          </div>
          <RecentActivityList data={audit.slice(0, 5)} />
        </div>
      </div>
    </>
  );
}

import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, EmptyState } from "@/components/data/primitives";
import { RelativeTime } from "@/components/data/relative-time";
import { NewDistributionSheet } from "@/features/actions";
import { api } from "@/features/api";
import { requirePermission } from "@/lib/server/session";

export const metadata = { title: "Distributions" };

export default async function Page() {
  const me = await requirePermission("catalog.distribute");
  const [{ data: distributions }, { data: stores }, { data: products }] = await Promise.all([api.distributions(), api.stores(), api.products()]);
  const variants = products
    .filter((p) => p.variantId)
    .map((p) => ({ id: p.variantId as string, label: `${p.name}${p.sku ? ` (${p.sku})` : ""}`, defaultPriceCents: p.priceMinor ?? 0, defaultTaxGroupId: p.taxGroupId ?? null }));
  const canCreate = me.permissions.organization.includes("catalog.distribute");
  return (
    <>
      <PageHeader title="Distributions" description="Send products from the organisation to a store with a suggested price. The store manager verifies before anything goes on sale." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Distributions" }]}
        actions={canCreate ? <NewDistributionSheet stores={stores.map((s) => ({ id: s.id, name: s.name, code: s.code }))} variants={variants} /> : undefined} />
      <Card>
        <CardContent>
          {distributions.length === 0 ? <EmptyState title="No distributions yet" description="Push master products out to a store to seed its catalogue with pending stock." /> : (
            <table className="w-full text-sm">
              <thead className="bg-secondary/60"><tr className="border-b text-left text-xs font-semibold text-muted-foreground">
                <th className="px-4 py-2">When</th><th className="px-4 py-2">To store</th><th className="px-4 py-2">Items</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Notes</th>
              </tr></thead>
              <tbody>
                {distributions.map((d) => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-muted-foreground"><RelativeTime value={d.createdAt} /></td>
                    <td className="px-4 py-2.5">{d.toStoreName} <span className="text-xs text-muted-foreground">· {d.toStoreCode}</span></td>
                    <td className="px-4 py-2.5">{d.lines.map((l) => <div key={l.variantId}>{l.quantity} × {l.name}</div>)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={d.status} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{d.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/data/primitives";
import { EmptyState } from "@/components/data/primitives";
import { RelativeTime } from "@/components/data/relative-time";
import { NewTransferSheet, TransferActions } from "@/features/actions";
import { api } from "@/features/api";

export const metadata = { title: "Stock transfers" };

export default async function Page() {
  await requirePermission("transfer.manage");
  const [{ data: transfers }, { data: locations }, { data: products }] = await Promise.all([api.transfers(), api.locations(), api.products()]);
  const variants = products.filter((p) => p.variantId).map((p) => ({ id: p.variantId as string, label: `${p.name}${p.sku ? ` (${p.sku})` : ""}` }));
  return (
    <>
      <PageHeader title="Stock transfers" description="Move stock between stock locations. Stock leaves the source when a transfer is dispatched and arrives at the destination (and joins its catalogue) when it is received." crumbs={[{ label: "Organisation", href: "/org" }, { label: "Stock transfers" }]} actions={<NewTransferSheet locations={locations.map((l) => ({ id: l.id, name: l.name }))} variants={variants} />} />
      <Card>
        {transfers.length === 0 ? <EmptyState title="No transfers yet" description="Create a transfer to move stock from one location to another." /> : (
          <table className="w-full text-sm"><thead className="bg-secondary/60"><tr className="border-b text-left text-xs font-semibold text-muted-foreground"><th className="px-4 py-2">Requested</th><th className="px-4 py-2">From</th><th className="px-4 py-2">To</th><th className="px-4 py-2">Items</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Notes</th><th className="px-4 py-2" /></tr></thead>
            <tbody>{transfers.map((t) => <tr key={t.id} className="border-b last:border-0"><td className="px-4 py-2.5 text-muted-foreground"><RelativeTime value={t.createdAt} /></td><td className="px-4 py-2.5">{t.fromLocationName}</td><td className="px-4 py-2.5">{t.toLocationName}</td><td className="px-4 py-2.5">{t.lines.map((l) => <div key={l.variantId}>{l.requestedQuantity} × {l.name}</div>)}</td><td className="px-4 py-2.5"><StatusBadge status={t.status} /></td><td className="px-4 py-2.5 text-muted-foreground">{t.notes || "—"}</td><td className="px-4 py-2.5"><TransferActions id={t.id} status={t.status} /></td></tr>)}</tbody></table>
        )}
      </Card>
    </>
  );
}

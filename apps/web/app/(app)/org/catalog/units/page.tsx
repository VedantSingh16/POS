import { requirePermission } from "@/lib/server/session";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/data/primitives";
import { NewUomSheet } from "@/features/actions";
import { api } from "@/features/api";

export const metadata = { title: "Units" };

export default async function Page() {
  await requirePermission("catalog.view");
  const { data } = await api.uoms();
  return (
    <>
      <PageHeader title="Units" description="Choose a unit on each sellable variant. It labels quantities in inventory and on bills; it does not convert between units." crumbs={[{ label: "Catalogue", href: "/org/catalog/products" }, { label: "Units" }]} actions={<NewUomSheet />} />
      <Card>
        {data.length === 0 ? <EmptyState title="No units yet" description="Add units such as Piece, Kilogram, or Litre, then choose one on a product variant." /> : (
          <table className="w-full text-sm"><thead className="bg-secondary/60"><tr className="border-b text-left text-xs font-semibold text-muted-foreground"><th className="px-4 py-2">Code</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Fractions allowed</th></tr></thead>
            <tbody>{data.map((u) => <tr key={u.id} className="border-b last:border-0"><td className="px-4 py-2.5 font-mono text-xs">{u.code}</td><td className="px-4 py-2.5">{u.name}</td><td className="px-4 py-2.5 text-muted-foreground">{u.allowsDecimal ? "Yes — fractional quantities" : "No — whole units only"}</td></tr>)}</tbody></table>
        )}
      </Card>
    </>
  );
}

import { requirePermission } from "@/lib/server/session";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Money, StatusBadge } from "@/components/data/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/features/api";
import { EditProductSheet, EditVariantSheet } from "@/features/catalog/edit-sheets";
import { AddVariantSheet } from "@/features/actions";

export default async function ProductDetail({ params }: PageProps<"/org/catalog/products/[id]">) {
  await requirePermission("catalog.view");
  const { id } = await params;
  const [{ data: p }, { data: categories }, { data: taxGroups }, { data: uoms }] = await Promise.all([api.product(id), api.categories(), api.taxGroups(), api.uoms()]);
  if (!p) notFound();
  const rows: [string, React.ReactNode][] = [["Brand", p.brand || "—"], ["Category", p.category?.name ?? "Uncategorised"], ["Description", p.description || "—"], ["Status", <StatusBadge key="status" status={p.status} />]];
  return (
    <>
      <PageHeader title={p.name} crumbs={[{ label: "Catalogue" }, { label: "Products", href: "/org/catalog/products" }, { label: p.name }]} actions={<EditProductSheet product={p} categories={categories} />} />
      <Card><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{rows.map(([key, value]) => <div key={key}><p className="text-xs text-muted-foreground">{key}</p><p className="font-medium">{value}</p></div>)}</CardContent></Card>
      <section className="mt-6 grid gap-3">
        <div className="flex items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Variants</h2><p className="text-sm text-muted-foreground">Prices are shown in paise values converted to the configured currency display.</p></div><AddVariantSheet productId={p.id} taxGroups={taxGroups.map((t) => ({ id: t.id, name: t.name }))} uoms={uoms} /></div>
        <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b bg-muted/40"><th className="p-3">Variant</th><th className="p-3">SKU</th><th className="p-3">Barcodes</th><th className="p-3">Price</th><th className="p-3">Cost</th><th className="p-3">Tax</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>
          {p.variants.map((variant) => <tr className="border-b last:border-0" key={variant.id}><td className="p-3 font-medium">{variant.name}</td><td className="p-3 font-mono text-xs">{variant.sku}</td><td className="p-3 font-mono text-xs">{variant.barcodes.join(", ") || "—"}</td><td className="p-3"><Money minor={variant.prices[0]?.amountCents ?? 0} /></td><td className="p-3"><Money minor={variant.costCents} /></td><td className="p-3">{taxGroups.find((tax) => tax.id === variant.taxGroupId)?.rate ?? 0}%</td><td className="p-3"><StatusBadge status={variant.status} /></td><td className="p-3"><EditVariantSheet variant={variant} taxGroups={taxGroups} /></td></tr>)}
          {p.variants.length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={8}>No variants have been added to this product.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  );
}

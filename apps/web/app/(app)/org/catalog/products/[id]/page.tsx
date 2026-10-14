import { requirePermission } from "@/lib/server/session";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Money, StatusBadge } from "@/components/data/primitives";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/features/api";
import { EditProductSheet, EditVariantSheet } from "@/features/catalog/edit-sheets";
import { AddVariantSheet } from "@/features/actions";
import type { ConfiguredField } from "@/features/settings/configurable-field-values";

export default async function ProductDetail({ params }: PageProps<"/org/catalog/products/[id]">) {
  await requirePermission("catalog.view");
  const { id } = await params;
  const [{ data: p }, { data: categories }, { data: uoms }, { data: productTypes }, { data: settings }] = await Promise.all([api.product(id), api.categories(), api.uoms(), api.productTypes(), api.settings()]);
  if (!p) notFound();
  const typeConfig = productTypes.find((type) => type.id === p.productTypeId)?.config;
  const productFieldSet = settings.productFields as { fields?: ConfiguredField[]; coreFields?: string[] } | undefined;
  const productFieldDefinitions = productFieldSet?.fields ?? [];
  const productCoreFields = productFieldSet?.coreFields ?? ["name", "description", "productType", "attributes", "brand", "category", "sku", "barcode", "price", "cost", "uom", "status", "openPrice", "floorPrice", "includesTax"];
  const productFields = productFieldDefinitions.filter((field) => field.level === "PRODUCT" && field.active);
  const variantFields = productFieldDefinitions.filter((field) => field.level === "VARIANT" && field.active);
  const rows: [string, React.ReactNode][] = [
    ...(productCoreFields.includes("productType") ? [["Type", p.productType?.name ?? "—"] as [string, React.ReactNode]] : []),
    ...(productCoreFields.includes("attributes") ? (typeConfig?.attributes ?? []).map((attribute): [string, React.ReactNode] => [attribute.label, p.attributes?.[attribute.key] === undefined ? "—" : typeof p.attributes[attribute.key] === "boolean" ? (p.attributes[attribute.key] ? "Yes" : "No") : String(p.attributes[attribute.key])]) : []),
    ...productFields.flatMap((field): [string, React.ReactNode][] => p.customFields?.[field.key] === undefined ? [] : [[field.label, String(p.customFields[field.key])]]),
    ...(productCoreFields.includes("brand") ? [["Brand", p.brand || "—"] as [string, React.ReactNode]] : []),
    ...(productCoreFields.includes("category") ? [["Category", p.category?.name ?? "Uncategorised"] as [string, React.ReactNode]] : []),
    ...(productCoreFields.includes("description") ? [["Description", p.description || "—"] as [string, React.ReactNode]] : []),
    ...(productCoreFields.includes("status") ? [["Status", <StatusBadge key="status" status={p.status} />] as [string, React.ReactNode]] : []),
  ];
  return (
    <>
      <PageHeader title={p.name} crumbs={[{ label: "Catalogue" }, { label: "Products", href: "/org/catalog/products" }, { label: p.name }]} backHref="/org/catalog/products" backLabel="Back to products" actions={<EditProductSheet product={p} categories={categories} productTypes={productTypes} customFieldDefinitions={productFieldDefinitions} coreFields={productCoreFields} />} />
      <Card><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{rows.map(([key, value]) => <div key={key}><p className="text-xs text-muted-foreground">{key}</p><p className="font-medium">{value}</p></div>)}</CardContent></Card>
      <section className="mt-6 grid gap-3">
        <div className="flex items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Variants</h2><p className="text-sm text-muted-foreground">Prices are in the organisation currency, set under Organisation settings. Each store assigns its own tax group.</p></div><AddVariantSheet productId={p.id} uoms={uoms} customFieldDefinitions={productFieldDefinitions} coreFields={productCoreFields} forceBarcode={typeConfig?.requireBarcode} /></div>
        <div className="overflow-x-auto rounded-lg border bg-card"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b bg-muted/40"><th className="p-3">Variant</th>{productCoreFields.includes("sku") && <th className="p-3">SKU</th>}{productCoreFields.includes("barcode") && <th className="p-3">Barcodes</th>}{productCoreFields.includes("price") && <th className="p-3">Price</th>}{productCoreFields.includes("cost") && <th className="p-3">Cost</th>}{productCoreFields.includes("status") && <th className="p-3">Status</th>}<th className="p-3">Actions</th></tr></thead><tbody>
          {p.variants.map((variant) => <tr className="border-b last:border-0" key={variant.id}><td className="p-3 font-medium">{variant.name}{variantFields.filter((field) => variant.customFields?.[field.key] !== undefined).map((field) => <span className="block text-xs font-normal text-muted-foreground" key={field.key}>{field.label}: {String(variant.customFields?.[field.key])}</span>)}</td>{productCoreFields.includes("sku") && <td className="p-3 font-mono text-xs">{variant.sku}</td>}{productCoreFields.includes("barcode") && <td className="p-3 font-mono text-xs">{variant.barcodes.join(", ") || "—"}</td>}{productCoreFields.includes("price") && <td className="p-3"><Money minor={variant.prices[0]?.amountCents ?? 0} /></td>}{productCoreFields.includes("cost") && <td className="p-3"><Money minor={variant.costCents} /></td>}{productCoreFields.includes("status") && <td className="p-3"><StatusBadge status={variant.status} /></td>}<td className="p-3"><EditVariantSheet variant={variant} customFieldDefinitions={productFieldDefinitions} coreFields={productCoreFields} forceBarcode={typeConfig?.requireBarcode} /></td></tr>)}
          {p.variants.length === 0 && <tr><td className="p-4 text-muted-foreground" colSpan={2 + ["sku", "barcode", "price", "cost", "status"].filter((key) => productCoreFields.includes(key)).length}>No variants have been added to this product.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  );
}

"use client";

import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormSheet } from "@/components/form/dialogs";
import { SheetClose } from "@/components/ui/sheet";
import { clientApi } from "@/features/client-api";
import type { CatalogProductDetail } from "@/features/api";

const statuses = ["DRAFT", "ACTIVE", "DISCONTINUED", "SEASONAL", "BLOCKED"] as const;

export function EditProductSheet({ product, categories }: {
  product: Pick<CatalogProductDetail, "id" | "name" | "description" | "brand" | "categoryId" | "status">;
  categories: { id: string; name: string }[];
}) {
  const form = useForm({ defaultValues: { name: product.name, description: product.description, brand: product.brand, categoryId: product.categoryId ?? "", status: product.status } });
  return <FormSheet trigger={<Button variant="outline">Edit product</Button>} title="Edit product" description="Update the product identity, category and status."><form className="grid gap-4 pb-6" onSubmit={form.handleSubmit(async (value) => {
    try {
      await clientApi(`/admin/catalog/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ ...value, categoryId: value.categoryId || null }) });
      toast.success("Product updated");
      window.location.reload();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update product"); }
  })}>
    <Field label="Product name" htmlFor={`edit-product-name-${product.id}`}><Input id={`edit-product-name-${product.id}`} required minLength={2} {...form.register("name", { required: true, minLength: 2 })} /></Field>
    <Field label="Brand" htmlFor={`edit-product-brand-${product.id}`}><Input id={`edit-product-brand-${product.id}`} {...form.register("brand")} /></Field>
    <Field label="Description" htmlFor={`edit-product-description-${product.id}`}><Input id={`edit-product-description-${product.id}`} {...form.register("description")} /></Field>
    <Field label="Category" htmlFor={`edit-product-category-${product.id}`}><NativeSelect id={`edit-product-category-${product.id}`} {...form.register("categoryId")}><option value="">Uncategorised</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</NativeSelect></Field>
    <Field label="Status" htmlFor={`edit-product-status-${product.id}`}><NativeSelect id={`edit-product-status-${product.id}`} {...form.register("status")}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</NativeSelect></Field>
    <div className="flex justify-end gap-2"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Saving…" : "Save product"}</Button></div>
  </form></FormSheet>;
}

export function EditVariantSheet({ variant, taxGroups }: {
  variant: CatalogProductDetail["variants"][number];
  taxGroups: { id: string; name: string; rate: number }[];
}) {
  const form = useForm({ defaultValues: {
    name: variant.name,
    sku: variant.sku,
    status: variant.status,
    costCents: String(variant.costCents),
    amountCents: String(variant.prices[0]?.amountCents ?? 0),
    taxGroupId: variant.taxGroupId ?? "",
    barcodes: variant.barcodes.join(", "),
    includesTax: variant.prices[0]?.includesTax ?? false,
  } });
  return <FormSheet trigger={<Button size="sm" variant="outline">Edit variant</Button>} title={`Edit ${variant.sku}`} description="SKU and barcode uniqueness are enforced by the catalogue API."><form className="grid gap-4 pb-6" onSubmit={form.handleSubmit(async (value) => {
    const costCents = Number(value.costCents);
    const amountCents = Number(value.amountCents);
    if (!Number.isInteger(costCents) || costCents < 0 || !Number.isInteger(amountCents) || amountCents < 0) {
      toast.error("Cost and price must be non-negative whole numbers in paise.");
      return;
    }
    try {
      await clientApi(`/admin/catalog/variants/${variant.id}`, { method: "PATCH", body: JSON.stringify({
        name: value.name, sku: value.sku, status: value.status, costCents, amountCents,
        taxGroupId: value.taxGroupId || null, barcodes: value.barcodes.split(",").map((code) => code.trim()).filter(Boolean),
        includesTax: value.includesTax,
      }) });
      toast.success("Variant updated; the new price is recorded in price history");
      window.location.reload();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update variant"); }
  })}>
    <Field label="Variant name" htmlFor={`variant-name-${variant.id}`}><Input id={`variant-name-${variant.id}`} required {...form.register("name", { required: true })} /></Field>
    <Field label="SKU" htmlFor={`variant-sku-${variant.id}`}><Input id={`variant-sku-${variant.id}`} required {...form.register("sku", { required: true })} /></Field>
    <Field label="Barcodes (comma-separated)" htmlFor={`variant-barcodes-${variant.id}`}><Input id={`variant-barcodes-${variant.id}`} {...form.register("barcodes")} /></Field>
    <Field label="Price (paise)" htmlFor={`variant-price-${variant.id}`}><Input id={`variant-price-${variant.id}`} type="number" min="0" step="1" required {...form.register("amountCents", { required: true })} /></Field>
    <Field label="Cost (paise)" htmlFor={`variant-cost-${variant.id}`}><Input id={`variant-cost-${variant.id}`} type="number" min="0" step="1" required {...form.register("costCents", { required: true })} /></Field>
    <Field label="Tax group" htmlFor={`variant-tax-${variant.id}`}><NativeSelect id={`variant-tax-${variant.id}`} {...form.register("taxGroupId")}><option value="">No tax group</option>{taxGroups.map((tax) => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}</NativeSelect></Field>
    <Field label="Status" htmlFor={`variant-status-${variant.id}`}><NativeSelect id={`variant-status-${variant.id}`} {...form.register("status")}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</NativeSelect></Field>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("includesTax")} /> Price includes tax</label>
    <div className="flex justify-end gap-2"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Saving…" : "Save variant"}</Button></div>
  </form></FormSheet>;
}

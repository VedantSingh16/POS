"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormSheet } from "@/components/form/dialogs";
import { SheetClose } from "@/components/ui/sheet";
import { clientApi } from "@/features/client-api";
import type { CatalogProductDetail } from "@/features/api";
import { currencyCode, toInput, toMinor } from "@/lib/format";
import type { ProductTypeRow } from "@/features/api";
import { allowedBy, missingAttribute, ProductTypeFields, type AttributeValues } from "@/features/catalog/product-type-fields";
import { ConfigurableFieldValues, type ConfiguredField } from "@/features/settings/configurable-field-values";

const statuses = ["DRAFT", "ACTIVE", "DISCONTINUED", "SEASONAL", "BLOCKED"] as const;
const statusLabels: Record<(typeof statuses)[number], string> = { DRAFT: "Draft", ACTIVE: "Active", DISCONTINUED: "Discontinued", SEASONAL: "Seasonal", BLOCKED: "Blocked" };

export function EditProductSheet({ product, categories, productTypes = [], customFieldDefinitions = [], coreFields }: {
  product: Pick<CatalogProductDetail, "id" | "name" | "description" | "brand" | "categoryId" | "status" | "productTypeId" | "attributes" | "customFields">;
  categories: { id: string; name: string }[];
  productTypes?: ProductTypeRow[];
  customFieldDefinitions?: ConfiguredField[];
  coreFields?: string[];
}) {
  const [typeId, setTypeId] = useState(product.productTypeId ?? "");
  const [typeValues, setTypeValues] = useState<AttributeValues>(product.attributes ?? {});
  const [customFields, setCustomFields] = useState<Record<string, string | number | boolean>>(product.customFields ?? {});
  const productFields = customFieldDefinitions.filter((field) => field.level === "PRODUCT");
  const visibleCore = coreFields ?? ["name", "description", "productType", "attributes", "brand", "category", "sku", "barcode", "price", "cost", "uom", "status", "openPrice", "floorPrice", "includesTax"];
  const selectedType = productTypes.find((item) => item.id === typeId);
  const showBrand = visibleCore.includes("brand") || selectedType?.config.requireBrand === true;
  const showCategory = visibleCore.includes("category") || selectedType?.config.requireCategory === true;
  const form = useForm({ defaultValues: { name: product.name, description: product.description, brand: product.brand, categoryId: product.categoryId ?? "", status: product.status } });
  return <FormSheet trigger={<Button variant="outline"><LocalizedText value={"Edit product"} /></Button>} title="Edit product" description="Update the product identity, category and status."><form className="grid gap-4 pb-6" onSubmit={form.handleSubmit(async (value) => {
    try {
      const type = productTypes.find((item) => item.id === typeId);
      const problem = missingAttribute(type, typeValues);
      if (problem) { toast.error(problem); return; }
      await clientApi(`/admin/catalog/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ ...value, categoryId: value.categoryId || null, productTypeId: typeId || null, customFields, attributes: typeId ? Object.fromEntries(Object.entries(typeValues).filter(([, v]) => v !== "")) : {} }) });
      toast.success("Product updated");
      window.location.reload();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update product"); }
  })}>
    {(visibleCore.includes("productType") || visibleCore.includes("attributes")) && <ProductTypeFields idPrefix={`edit-product-${product.id}`} types={productTypes} typeId={typeId} onTypeChange={setTypeId} values={typeValues} onValuesChange={setTypeValues} showType={visibleCore.includes("productType")} showAttributes={visibleCore.includes("attributes")} />}
    <ConfigurableFieldValues fields={productFields} values={customFields} onChange={setCustomFields} idPrefix={`edit-product-field-${product.id}`} />
    <Field label="Product name" htmlFor={`edit-product-name-${product.id}`}><Input id={`edit-product-name-${product.id}`} required minLength={2} {...form.register("name", { required: true, minLength: 2 })} /></Field>
    {showBrand && <Field label={selectedType?.config.requireBrand ? "Brand · required by this product type" : "Brand"} htmlFor={`edit-product-brand-${product.id}`}><Input id={`edit-product-brand-${product.id}`} {...form.register("brand")} /></Field>}
    {visibleCore.includes("description") && <Field label="Description" htmlFor={`edit-product-description-${product.id}`}><Input id={`edit-product-description-${product.id}`} {...form.register("description")} /></Field>}
    {showCategory && <Field label="Category" htmlFor={`edit-product-category-${product.id}`}><NativeSelect id={`edit-product-category-${product.id}`} {...form.register("categoryId")}><option value=""><LocalizedText value={"Uncategorised"} /></option>{allowedBy(selectedType, "categoryIds", categories).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</NativeSelect></Field>}
    {visibleCore.includes("status") && <Field label="Status" htmlFor={`edit-product-status-${product.id}`}><NativeSelect id={`edit-product-status-${product.id}`} {...form.register("status")}>{statuses.map((status) => <option key={status} value={status}><LocalizedText value={statusLabels[status]} /></option>)}</NativeSelect></Field>}
    <div className="flex justify-end gap-2"><SheetClose asChild><Button type="button" variant="outline"><LocalizedText value={"Cancel"} /></Button></SheetClose><Button type="submit" disabled={form.formState.isSubmitting}><LocalizedText value={form.formState.isSubmitting ? "Saving…" : "Save product"} /></Button></div>
  </form></FormSheet>;
}

export function EditVariantSheet({ variant, customFieldDefinitions = [], coreFields, forceBarcode = false }: {
  variant: CatalogProductDetail["variants"][number];
  customFieldDefinitions?: ConfiguredField[];
  coreFields?: string[];
  forceBarcode?: boolean;
}) {
  const [customFields, setCustomFields] = useState<Record<string, string | number | boolean>>(variant.customFields ?? {});
  const variantFields = customFieldDefinitions.filter((field) => field.level === "VARIANT");
  const visibleCore = coreFields ?? ["name", "description", "productType", "attributes", "brand", "category", "sku", "barcode", "price", "cost", "uom", "status", "openPrice", "floorPrice", "includesTax"];
  const form = useForm({ defaultValues: {
    name: variant.name,
    sku: variant.sku,
    status: variant.status,
    costCents: toInput(variant.costCents),
    amountCents: toInput(variant.prices[0]?.amountCents ?? 0),
    openPrice: variant.openPrice ?? false,
    floorPriceCents: toInput(variant.floorPriceCents ?? 0),
    barcodes: variant.barcodes.join(", "),
    includesTax: variant.prices[0]?.includesTax ?? false,
  } });
  return <FormSheet trigger={<Button size="sm" variant="outline"><LocalizedText value={"Edit variant"} /></Button>} title={`Edit ${variant.sku}`} description="SKU and barcode uniqueness are enforced by the catalogue API."><form className="grid gap-4 pb-6" onSubmit={form.handleSubmit(async (value) => {
    const costCents = toMinor(value.costCents);
    const amountCents = toMinor(value.amountCents);
    const floorPriceCents = toMinor(value.floorPriceCents || 0);
    if (![costCents, amountCents, floorPriceCents].every((n) => Number.isInteger(n) && n >= 0)) {
      toast.error("Cost, price and lowest price must be amounts in rupees, zero or more.");
      return;
    }
    try {
      await clientApi(`/admin/catalog/variants/${variant.id}`, { method: "PATCH", body: JSON.stringify({
        name: value.name, sku: value.sku, status: value.status, costCents, amountCents, openPrice: value.openPrice, floorPriceCents,
        barcodes: value.barcodes.split(",").map((code) => code.trim()).filter(Boolean),
        includesTax: value.includesTax,
        customFields,
      }) });
      toast.success("Variant updated; the new price is recorded in price history");
      window.location.reload();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update variant"); }
  })}>
    <Field label="Variant name" htmlFor={`variant-name-${variant.id}`}><Input id={`variant-name-${variant.id}`} required {...form.register("name", { required: true })} /></Field>
    <Field label="SKU" htmlFor={`variant-sku-${variant.id}`}><Input id={`variant-sku-${variant.id}`} required {...form.register("sku", { required: true })} /></Field>
    {(visibleCore.includes("barcode") || forceBarcode) && <Field label="Barcodes (comma-separated)" htmlFor={`variant-barcodes-${variant.id}`}><Input id={`variant-barcodes-${variant.id}`} {...form.register("barcodes")} /></Field>}
    <Field label={`Base price (${currencyCode()})`} htmlFor={`variant-price-${variant.id}`}><Input id={`variant-price-${variant.id}`} type="number" min="0" step="0.01" required {...form.register("amountCents", { required: true })} /></Field>
    {visibleCore.includes("cost") && <Field label={`Cost (${currencyCode()})`} htmlFor={`variant-cost-${variant.id}`}><Input id={`variant-cost-${variant.id}`} type="number" min="0" step="0.01" required {...form.register("costCents", { required: true })} /></Field>}
    {visibleCore.includes("status") && <Field label="Status" htmlFor={`variant-status-${variant.id}`}><NativeSelect id={`variant-status-${variant.id}`} {...form.register("status")}>{statuses.map((status) => <option key={status} value={status}><LocalizedText value={statusLabels[status]} /></option>)}</NativeSelect></Field>}
    <ConfigurableFieldValues fields={variantFields} values={customFields} onChange={setCustomFields} idPrefix={`edit-variant-field-${variant.id}`} />
    {visibleCore.includes("includesTax") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("includesTax")} /> <LocalizedText value={"Price includes tax"} /></label>}
    {visibleCore.includes("openPrice") && <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("openPrice")} /> <LocalizedText value={"Open price: the cashier enters the price at the till (manager PIN needed)"} /></label>}
    {visibleCore.includes("floorPrice") && <Field label={`Lowest allowed price (${currencyCode()})`} htmlFor={`variant-floor-${variant.id}`}><Input id={`variant-floor-${variant.id}`} type="number" min="0" step="0.01" {...form.register("floorPriceCents")} /></Field>}
    <div className="flex justify-end gap-2"><SheetClose asChild><Button type="button" variant="outline"><LocalizedText value={"Cancel"} /></Button></SheetClose><Button type="submit" disabled={form.formState.isSubmitting}><LocalizedText value={form.formState.isSubmitting ? "Saving…" : "Save variant"} /></Button></div>
  </form></FormSheet>;
}

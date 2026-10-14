"use client";

import * as React from "react";
import { useMemo, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { FormSheet } from "@/components/form/dialogs";
import { SheetClose } from "@/components/ui/sheet";
import { clientApi } from "@/features/client-api";
import { buildVariantCombinations } from "@/features/catalog/variant-builder";
import { currencyCode, toMinor } from "@/lib/format";
import type { ProductTypeRow } from "@/features/api";
import { allowedBy, missingAttribute, ProductTypeFields, type AttributeValues } from "@/features/catalog/product-type-fields";
import { ConfigurableFieldValues, type ConfiguredField } from "@/features/settings/configurable-field-values";

export function NewCategorySheet() {
  const form = useForm<{ name: string }>({ resolver: zodResolver(z.object({ name: z.string().trim().min(2) })) });
  return <FormSheet trigger={<Button><Plus /> Add category</Button>} title="Add category" description="Categories are shared across stores."><form className="grid gap-4" onSubmit={form.handleSubmit(async (value) => { try { await clientApi("/admin/catalog/categories", { method: "POST", body: JSON.stringify(value) }); toast.success("Category created"); window.location.reload(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create category"); } })}><Field label="Name" htmlFor="category-name" error={form.formState.errors.name?.message}><Input id="category-name" {...form.register("name")} /></Field><div className="flex justify-end gap-2"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button type="submit">Create</Button></div></form></FormSheet>;
}

export function NewBrandSheet() {
  const form = useForm<{ name: string }>({ resolver: zodResolver(z.object({ name: z.string().trim().min(1).max(80) })) });
  return <FormSheet trigger={<Button><Plus /> Add brand</Button>} title="Add brand" description="Pick this brand from the Brand field on any product."><form className="grid gap-4" onSubmit={form.handleSubmit(async (value) => { try { await clientApi("/admin/catalog/brands", { method: "POST", body: JSON.stringify(value) }); toast.success("Brand created"); window.location.reload(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create brand"); } })}><Field label="Name" htmlFor="brand-name" error={form.formState.errors.name?.message}><Input id="brand-name" {...form.register("name")} /></Field><div className="flex justify-end gap-2"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button type="submit">Create</Button></div></form></FormSheet>;
}

export function NewTaxGroupSheet() {
  const form = useForm({ resolver: zodResolver(z.object({ code: z.string().trim().min(2), name: z.string().trim().min(2), ratePercent: z.coerce.number().min(0).max(100), hsnCode: z.string().optional(), includesTax: z.boolean().optional() })), defaultValues: { includesTax: false, ratePercent: 0 } });
  return <FormSheet trigger={<Button><Plus /> Add tax group</Button>} title="Add tax group" description="GST rate and HSN metadata are used on invoices."><form className="grid gap-4" onSubmit={form.handleSubmit(async (value) => { try { await clientApi("/admin/catalog/tax-groups", { method: "POST", body: JSON.stringify(value) }); toast.success("Tax group created"); window.location.reload(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create tax group"); } })}><Field label="Code" htmlFor="tax-code"><Input id="tax-code" {...form.register("code")} /></Field><Field label="Name" htmlFor="tax-name"><Input id="tax-name" {...form.register("name")} /></Field><Field label="GST rate (%)" htmlFor="tax-rate"><Input id="tax-rate" type="number" {...form.register("ratePercent")} /></Field><Field label="HSN/SAC" htmlFor="tax-hsn"><Input id="tax-hsn" {...form.register("hsnCode")} /></Field><label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("includesTax")} /> Prices include tax</label><div className="flex justify-end gap-2"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button type="submit">Create</Button></div></form></FormSheet>;
}

export function NewProductSheet({ stores, brands, categories, productTypes: productTypesProp, productFields: productFieldSet }: { stores: { id: string; name: string; code: string }[]; brands: { id: string; name: string }[]; categories: { id: string; name: string }[]; productTypes?: ProductTypeRow[]; productFields?: { fields: ConfiguredField[]; coreFields?: string[] } }) {
  const productTypes = productTypesProp ?? [];
  const coreFields = productFieldSet?.coreFields ?? ["name", "description", "productType", "attributes", "brand", "category", "sku", "barcode", "price", "cost", "uom", "status"];
  const configuredFields = productFieldSet?.fields ?? [];
  const productFields = configuredFields.filter((field) => field.level === "PRODUCT");
  const variantFields = configuredFields.filter((field) => field.level === "VARIANT");
  const [typeId, setTypeId] = useState("");
  const [typeValues, setTypeValues] = useState<AttributeValues>({});
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [openingQty, setOpeningQty] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("");
  const [skuPrefix, setSkuPrefix] = useState("");
  const [productFieldValues, setProductFieldValues] = useState<Record<string, string | number | boolean>>({});
  const [attributes, setAttributes] = useState([{ id: "attribute-1", name: "Variant", values: "Standard" }]);
  const [edits, setEdits] = useState<Record<string, { sku?: string; barcode?: string; price?: string; customFields?: Record<string, string | number | boolean> }>>({});
  const [pending, setPending] = useState(false);
  const selectedType = productTypes.find((item) => item.id === typeId);
  const showBrand = coreFields.includes("brand") || selectedType?.config.requireBrand === true;
  const showCategory = coreFields.includes("category") || selectedType?.config.requireCategory === true;
  const showBarcode = coreFields.includes("barcode") || selectedType?.config.requireBarcode === true;
  const combinations = useMemo(() => buildVariantCombinations(attributes), [attributes]);

  function updateAttribute(id: string, field: "name" | "values", value: string) {
    setAttributes((current) => current.map((attribute) => attribute.id === id ? { ...attribute, [field]: value } : attribute));
  }

  function updateVariant(key: string, field: "sku" | "barcode" | "price", value: string) {
    setEdits((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
  }
  function updateVariantFields(key: string, values: Record<string, string | number | boolean>) {
    setEdits((current) => ({ ...current, [key]: { ...current[key], customFields: values } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const productName = name.trim();
    if (productName.length < 2 || !skuPrefix.trim() || combinations.length === 0) {
      toast.error("Enter a product name, SKU prefix, and at least one value for every attribute.");
      return;
    }
    const missingProductField = productFields.find((field) => field.required && (productFieldValues[field.key] === undefined || productFieldValues[field.key] === ""));
    if (missingProductField) { toast.error(`${missingProductField.label} is required.`); return; }
    const missingVariantField = combinations.flatMap((combination) => variantFields.flatMap((field) => field.required && (edits[combination.key]?.customFields?.[field.key] === undefined || edits[combination.key]?.customFields?.[field.key] === "") ? [{ combination, field }] : []))[0];
    if (missingVariantField) { toast.error(`${missingVariantField.field.label} is required for ${missingVariantField.combination.label}.`); return; }
    const type = productTypes.find((item) => item.id === typeId);
    const problem = missingAttribute(type, typeValues)
      ?? (type?.config.requireCategory && !categoryId ? `A category is required for ${type.name} products` : null)
      ?? (type?.config.requireBrand && !brandId && !brand.trim() ? `A brand is required for ${type.name} products` : null)
      ?? (type?.config.requireBarcode && combinations.some((combination) => !edits[combination.key]?.barcode?.trim()) ? `Every variant needs a barcode for ${type.name} products` : null);
    if (problem) { toast.error(problem); return; }
    const variants = combinations.map((combination, index) => {
      const values = edits[combination.key];
      const generatedSku = `${skuPrefix.trim()}-${String(index + 1).padStart(2, "0")}`;
      const price = values?.price ?? "0";
      return {
        name: combination.label,
        sku: (values?.sku ?? generatedSku).trim(),
        barcode: values?.barcode?.trim() || undefined,
        amountCents: toMinor(price),
        includesTax: true,
        customFields: edits[combination.key]?.customFields ?? {},
      };
    });
    if (variants.some((variant) => !variant.sku || !Number.isInteger(variant.amountCents) || variant.amountCents < 0)) {
      toast.error(`Each variant needs a SKU and a price of 0 or more (in ${currencyCode()}).`);
      return;
    }
    if (new Set(variants.map((variant) => variant.sku.toUpperCase())).size !== variants.length) {
      toast.error("Each generated variant must have a unique SKU.");
      return;
    }
    if (new Set(variants.flatMap((variant) => variant.barcode ? [variant.barcode] : [])).size !== variants.filter((variant) => variant.barcode).length) {
      toast.error("Each generated variant must have a unique barcode.");
      return;
    }
    setPending(true);
    let created = 0;
    let productId: string | undefined;
    let variantIds: string[] = [];
    try {
      const product = await clientApi<{ id: string }>("/admin/catalog/products", { method: "POST", body: JSON.stringify({ name: productName, description: description.trim(), brand: brand.trim(), brandId: brandId || undefined, categoryId: categoryId || undefined, customFields: productFieldValues, ...(typeId ? { productTypeId: typeId, attributes: Object.fromEntries(Object.entries(typeValues).filter(([, value]) => value !== "")) } : {}) }) });
      productId = product.id;
      for (const variant of variants) {
        const saved = await clientApi<{ variants: { id: string }[] }>(`/admin/catalog/products/${product.id}/variants`, { method: "POST", body: JSON.stringify(variant) });
        variantIds = saved.variants.map((item) => item.id);
        created += 1;
      }
      // Each store sells its own set of products. The product is sent to the chosen stores as Pending:
      // the store sees it under Products and chooses "Add to store" (its category and brand come with it).
      const qty = Number(openingQty);
      for (const storeId of storeIds) {
        await clientApi("/pos/v1/distributions", { method: "POST", body: JSON.stringify({ toStoreId: storeId, dispatch: true, notes: `New product: ${productName}`, lines: variantIds.map((variantId) => ({ variantId, quantity: Number.isFinite(qty) && qty > 0 ? qty : 0 })) }) });
      }
      toast.success(`Product created with ${created} variant${created === 1 ? "" : "s"}.`);
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create product";
      toast.error(productId ? `Product ${productId} was created; ${created} of ${variants.length} variants were saved. ${message}` : message);
    } finally {
      setPending(false);
    }
  }

  return <FormSheet size="xl" trigger={<Button><Plus /> New product</Button>} title="New product" description="Define attributes to generate variants, then review each SKU, barcode and price."><form className="grid gap-4 pb-2" onSubmit={submit}>
    <Field label="Product name" htmlFor="product-name"><Input id="product-name" required minLength={2} value={name} onChange={(event) => setName(event.target.value)} /></Field>
    {(coreFields.includes("productType") || coreFields.includes("attributes")) && <ProductTypeFields idPrefix="product" types={productTypes} typeId={typeId} onTypeChange={(id) => { setTypeId(id); const next = productTypes.find((item) => item.id === id); if (brandId && !allowedBy(next, "brandIds", brands).some((b) => b.id === brandId)) { setBrandId(""); setBrand(""); } if (categoryId && !allowedBy(next, "categoryIds", categories).some((c) => c.id === categoryId)) setCategoryId(""); }} values={typeValues} onValuesChange={setTypeValues} showType={coreFields.includes("productType")} showAttributes={coreFields.includes("attributes")} />}
    <ConfigurableFieldValues fields={productFields} values={productFieldValues} onChange={setProductFieldValues} idPrefix="new-product-field" />
    {coreFields.includes("description") && <Field label="Description" htmlFor="product-description"><Input id="product-description" value={description} onChange={(event) => setDescription(event.target.value)} /></Field>}
    {showBrand && <Field label="Brand" htmlFor="product-brand"><NativeSelect id="product-brand" value={brandId} onChange={(event) => { setBrandId(event.target.value); const b = brands.find((item) => item.id === event.target.value); setBrand(b?.name ?? ""); }}><option value="">No brand</option>{allowedBy(selectedType, "brandIds", brands).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</NativeSelect></Field>}
    {showCategory && <Field label="Category" htmlFor="product-category"><NativeSelect id="product-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorised</option>{allowedBy(selectedType, "categoryIds", categories).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>}
    <Field label="SKU prefix" htmlFor="product-sku-prefix"><Input id="product-sku-prefix" required value={skuPrefix} onChange={(event) => setSkuPrefix(event.target.value)} placeholder="e.g. TSHIRT" /></Field>
    <section className="grid gap-2" aria-label="Stores that sell this product">
      <div><h3 className="text-sm font-semibold">Send to stores</h3><p className="text-xs text-muted-foreground">Each store has its own catalogue. Selected stores receive the product as <b>Pending</b> and add it themselves. Leave all unchecked to keep it in the organisation catalogue only; you can send it later from Distributions.</p></div>
      {stores.length === 0 ? <p className="text-sm text-muted-foreground">No stores yet.</p> : <div className="grid gap-1.5 sm:grid-cols-2">{stores.map((store) => <label key={store.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={storeIds.includes(store.id)} onChange={() => setStoreIds((current) => current.includes(store.id) ? current.filter((id) => id !== store.id) : [...current, store.id])} /> {store.name} <span className="text-muted-foreground">({store.code})</span></label>)}</div>}
      {storeIds.length > 0 && <Field label={combinations.length === 1 ? "Stock to send to each store" : "Stock to send per variant, to each store"} htmlFor="product-opening"><Input id="product-opening" type="number" min="0" value={openingQty} onChange={(event) => setOpeningQty(event.target.value)} placeholder="Optional (0 sends the product without stock)" /></Field>}
    </section>
    <section className="grid gap-2" aria-label="Variant attributes">
      <div><h3 className="text-sm font-semibold">Variant attributes</h3><p className="text-xs text-muted-foreground">Enter comma-separated values. Every combination becomes a variant.</p></div>
      {attributes.map((attribute) => <div className="grid grid-cols-[1fr_2fr_auto] gap-2" key={attribute.id}>
        <Input aria-label="Attribute name" value={attribute.name} onChange={(event) => updateAttribute(attribute.id, "name", event.target.value)} placeholder="Attribute (e.g. Size)" />
        <Input aria-label={`${attribute.name || "Attribute"} values`} value={attribute.values} onChange={(event) => updateAttribute(attribute.id, "values", event.target.value)} placeholder="Values (e.g. S, M, L)" />
        <Button type="button" variant="outline" aria-label={`Remove ${attribute.name || "attribute"}`} onClick={() => setAttributes((current) => current.filter((item) => item.id !== attribute.id))}>Remove</Button>
      </div>)}
      <Button type="button" variant="outline" className="w-fit" onClick={() => setAttributes((current) => [...current, { id: `attribute-${Date.now()}`, name: "", values: "" }])}>Add attribute</Button>
    </section>
    <section className="grid gap-2" aria-label="Generated variants">
      <h3 className="text-sm font-semibold">Generated variants ({combinations.length})</h3>
      {combinations.length === 0 ? <p className="text-sm text-muted-foreground">Add uniquely named attributes, each with unique comma-separated values.</p> : <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b bg-muted/40"><th className="p-2">Variant</th><th className="p-2">SKU</th>{showBarcode && <th className="p-2">Barcode</th>}<th className="p-2">Base price ({currencyCode()})</th></tr></thead><tbody>
        {combinations.map((combination, index) => <React.Fragment key={combination.key}><tr className="border-b last:border-0"><th scope="row" className="p-2 font-medium">{combination.label}</th><td className="p-2"><Input aria-label={`${combination.label} SKU`} required value={edits[combination.key]?.sku ?? `${skuPrefix.trim()}-${String(index + 1).padStart(2, "0")}`} onChange={(event) => updateVariant(combination.key, "sku", event.target.value)} /></td>{showBarcode && <td className="p-2"><Input aria-label={`${combination.label} barcode`} value={edits[combination.key]?.barcode ?? ""} onChange={(event) => updateVariant(combination.key, "barcode", event.target.value)} /></td>}<td className="p-2"><Input aria-label={`${combination.label} price in rupees`} type="number" min="0" step="0.01" required value={edits[combination.key]?.price ?? "0"} onChange={(event) => updateVariant(combination.key, "price", event.target.value)} /></td></tr>{variantFields.length > 0 && <tr className="border-b"><td colSpan={showBarcode ? 4 : 3} className="bg-muted/20 p-3"><details><summary className="cursor-pointer text-xs font-medium">Extra variant fields</summary><div className="mt-3"><ConfigurableFieldValues fields={variantFields} values={edits[combination.key]?.customFields ?? {}} onChange={(values) => updateVariantFields(combination.key, values)} idPrefix={`variant-${combination.key}`} /></div></details></td></tr>}</React.Fragment>)}
      </tbody></table></div>}
    </section>
    <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t bg-popover px-5 py-3"><SheetClose asChild><Button type="button" variant="outline">Cancel</Button></SheetClose><Button type="submit" disabled={pending || combinations.length === 0}>{pending ? "Creating…" : `Create ${combinations.length} variant${combinations.length === 1 ? "" : "s"}`}</Button></div>
  </form></FormSheet>;
}

"use client";
import { LocalizedText, useTranslate } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import type { ConfiguredField } from "@/features/settings/configurable-field-values";

type FieldSet = { version: 1; allowStoreFields: boolean; fields: ConfiguredField[]; coreFields: string[] };
type StoreFieldSet = { version: 1; overrides: Record<string, Partial<ConfiguredField>>; fields: ConfiguredField[]; coreFields?: string[] };
type Props = {
  domain: "checkoutFields" | "productFields";
  scope: "organisation" | "store";
  storeId?: string;
  initial: FieldSet | StoreFieldSet;
  organisation?: FieldSet;
  initialRequireBillHandler?: boolean;
  requireBillHandlerOverride?: boolean | null;
  canEdit?: boolean;
};

const CORE_PRODUCT_FIELDS = ["name", "description", "productType", "attributes", "brand", "category", "sku", "barcode", "price", "cost", "uom", "status", "openPrice", "floorPrice", "includesTax", "variants"];
const LOCKED_PRODUCT_FIELDS = new Set(["name", "category", "sku", "price", "uom", "status"]);
const CORE_PRODUCT_LABELS: Record<string, string> = { name: "Product name", description: "Description", productType: "Product setup rule", attributes: "Rule attributes", brand: "Brand", category: "Category", sku: "SKU", barcode: "Barcode", price: "Price", cost: "Cost", uom: "Unit of measure", status: "Status", openPrice: "Open price", floorPrice: "Minimum open price", includesTax: "Price includes tax", variants: "Variants (size / colour)" };
const CORE_CHECKOUT_FIELDS = ["customer", "coupon", "discount", "discountReason", "paymentReference", "splitTender", "itemNote", "billHandler", "tender", "cashTendered"];
const LOCKED_CHECKOUT_FIELDS = new Set(["billHandler", "tender", "cashTendered"]);
const CORE_CHECKOUT_LABELS: Record<string, string> = { customer: "Customer picker", coupon: "Coupon code", discount: "Discounts (%)", discountReason: "Discount reason", paymentReference: "Payment reference", splitTender: "Split tender", itemNote: "Line note", billHandler: "Bill handler", tender: "Payment method", cashTendered: "Cash tendered" };
const emptyStore: StoreFieldSet = { version: 1, overrides: {}, fields: [] };
const newField = (index: number, level: "PRODUCT" | "VARIANT" = "PRODUCT"): ConfiguredField => ({ key: `field_${Date.now().toString(36)}_${index}`, label: "New field", type: "TEXT", required: false, active: true, order: index * 10, helpText: "", options: [], storeEditable: false, showOnReceipt: false, showInList: false, level });

export function FieldConfigurationEditor(props: Props) {
  const router = useRouter();
  const isOrg = props.scope === "organisation";
  const standardFields = props.domain === "checkoutFields" ? CORE_CHECKOUT_FIELDS : CORE_PRODUCT_FIELDS;
  const lockedFields = props.domain === "checkoutFields" ? LOCKED_CHECKOUT_FIELDS : LOCKED_PRODUCT_FIELDS;
  const labels = props.domain === "checkoutFields" ? CORE_CHECKOUT_LABELS : CORE_PRODUCT_LABELS;
  const emptyFields: FieldSet = { version: 1, allowStoreFields: false, fields: [], coreFields: standardFields };
  const [orgConfig, setOrgConfig] = React.useState<FieldSet>(() => {
    const seed = (isOrg ? props.initial as Partial<FieldSet> | undefined : props.organisation ?? emptyFields) ?? {};
    return { ...emptyFields, ...seed, ...(props.domain === "productFields" ? { allowStoreFields: false } : {}), fields: [...(seed.fields ?? [])], coreFields: seed.coreFields ?? standardFields };
  });
  const [storeConfig, setStoreConfig] = React.useState<StoreFieldSet>(() => {
    const seed = isOrg ? emptyStore : props.initial as Partial<StoreFieldSet>;
    return { ...emptyStore, ...seed, ...(props.domain === "productFields" ? { coreFields: undefined } : {}), overrides: { ...(seed.overrides ?? {}) }, fields: [...(seed.fields ?? [])] };
  });
  const [requireHandler, setRequireHandler] = React.useState(props.initialRequireBillHandler === true);
  const [requireHandlerOverride, setRequireHandlerOverride] = React.useState<boolean | null>(props.requireBillHandlerOverride ?? null);
  const [busy, setBusy] = React.useState(false);
  const localFields = isOrg ? orgConfig.fields : storeConfig.fields;

  function setOrgField(key: string, patch: Partial<ConfiguredField>) {
    setOrgConfig((current) => ({ ...current, fields: current.fields.map((field) => field.key === key ? { ...field, ...patch } : field) }));
  }
  function setLocalField(key: string, patch: Partial<ConfiguredField>) {
    setStoreConfig((current) => ({ ...current, fields: current.fields.map((field) => field.key === key ? { ...field, ...patch } : field) }));
  }
  function addField() {
    const next = newField(localFields.length, "PRODUCT");
    if (isOrg) setOrgConfig((current) => ({ ...current, fields: [...current.fields, next] }));
    else setStoreConfig((current) => ({ ...current, fields: [...current.fields, next] }));
  }
  function removeField(key: string) {
    if (isOrg) setOrgConfig((current) => ({ ...current, fields: current.fields.filter((field) => field.key !== key) }));
    else setStoreConfig((current) => ({ ...current, fields: current.fields.filter((field) => field.key !== key) }));
  }
  async function save() {
    setBusy(true);
    try {
      const fieldConfig = isOrg ? { ...orgConfig, ...(props.domain === "productFields" ? { allowStoreFields: false } : {}) } : props.domain === "checkoutFields" ? storeConfig : { version: storeConfig.version, overrides: storeConfig.overrides, fields: storeConfig.fields };
      if (isOrg) {
        const body: Record<string, unknown> = { [props.domain]: fieldConfig };
        if (props.domain === "checkoutFields") body.requireBillHandler = requireHandler;
        await clientApi("/admin/settings", { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const body: Record<string, unknown> = { [props.domain]: fieldConfig };
        if (props.domain === "checkoutFields") body.requireBillHandler = requireHandlerOverride;
        await clientApi(`/admin/stores/${props.storeId}/settings`, { method: "PATCH", body: JSON.stringify(body) });
      }
      toast.success("Field configuration saved");
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save field configuration"); }
    finally { setBusy(false); }
  }

  const definitions = isOrg ? orgConfig.fields : (props.organisation?.fields ?? []).filter((field) => props.domain !== "productFields" || field.active);
  const selectedCoreFields = isOrg ? orgConfig.coreFields : props.organisation?.coreFields ?? standardFields;
  const productGroups = [
    { title: "Identity", keys: ["name", "sku", "barcode"] },
    { title: "Details", keys: ["description", "productType", "attributes", "category", "brand", "variants"] },
    { title: "Stock and pricing", keys: ["price", "cost", "uom", "status", "openPrice", "floorPrice", "includesTax"] },
  ];
  const coreFieldControl = (key: string) => {
    const selected = selectedCoreFields.includes(key);
    const disabled = lockedFields.has(key) || (!isOrg && !props.organisation?.allowStoreFields);
    return <label className="flex min-h-9 items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm" key={key}>
      <input type="checkbox" checked={selected} disabled={disabled} onChange={(event) => isOrg
        ? setOrgConfig((current) => ({ ...current, coreFields: event.target.checked ? [...new Set([...current.coreFields, key])] : current.coreFields.filter((item) => item !== key) }))
        : setStoreConfig((current) => ({ ...current, coreFields: event.target.checked ? [...new Set([...(current.coreFields ?? props.organisation?.coreFields ?? standardFields), key])] : (current.coreFields ?? props.organisation?.coreFields ?? standardFields).filter((item) => item !== key) }))} />
      <LocalizedText value={labels[key] ?? key} />
    </label>;
  };
  return <div className={`grid gap-5${props.canEdit === false ? " pointer-events-none opacity-60" : ""}`}>
    <p className="text-sm text-muted-foreground"><LocalizedText value={props.domain === "checkoutFields" ? "Choose the checkout controls to show, then add extra information your team needs to capture." : "Choose the product details your catalogue needs. Add typed fields below when the standard details are not enough."} /> <LocalizedText value={"Saved product and bill records keep their original values."} /></p>
    {isOrg && props.domain === "checkoutFields" && <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input className="mt-1" type="checkbox" checked={orgConfig.allowStoreFields} onChange={(event) => setOrgConfig((current) => ({ ...current, allowStoreFields: event.target.checked }))} /><span><b><LocalizedText value={"Allow stores to add local checkout fields"} /></b><span className="block text-xs text-muted-foreground"><LocalizedText value={"Each store can capture additional bill information without changing the organization definition."} /></span></span></label>}
    {isOrg || props.domain === "checkoutFields" ? <section className="grid gap-4 rounded-md border p-3">
      <div><h3 className="text-sm font-semibold"><LocalizedText value={props.domain === "checkoutFields" ? "Checkout controls" : "Standard product details"} /></h3><p className="text-xs text-muted-foreground"><LocalizedText value={props.domain === "checkoutFields" ? "Optional controls can be hidden. Payment method, cash tendered, and bill handler remain available." : "Name, category, SKU, price, unit and status stay visible. Other details are configurable."} /></p></div>
      {props.domain === "productFields" ? productGroups.map((group) => <div key={group.title} className="grid gap-2"><h4 className="text-xs font-medium text-muted-foreground"><LocalizedText value={group.title} /></h4><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{group.keys.filter((key) => standardFields.includes(key)).map(coreFieldControl)}</div></div>) : <div className="grid gap-2 sm:grid-cols-2">{standardFields.map(coreFieldControl)}</div>}
    </section> : <section className="grid gap-2 rounded-md border border-dashed p-3"><div><h3 className="text-sm font-semibold"><LocalizedText value={"Product details set by the organisation"} /></h3><p className="text-xs text-muted-foreground"><LocalizedText value={"These stay in this store and are managed centrally. Add store-only details separately below."} /></p></div><div className="flex flex-wrap gap-2">{selectedCoreFields.map((key) => <span key={key} className="rounded-full bg-muted px-2.5 py-1 text-xs"><LocalizedText value={labels[key] ?? key} /><LocalizedText value={lockedFields.has(key) ? " · required" : ""} /></span>)}</div></section>}
    {isOrg && props.domain === "checkoutFields" && <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={requireHandler} onChange={(event) => setRequireHandler(event.target.checked)} /><span><b><LocalizedText value={"Require a bill handler selection"} /></b><span className="block text-xs text-muted-foreground"><LocalizedText value={"A bill handler is still recorded when this is off; the signed-in cashier is the default."} /></span></span></label>}
    {!isOrg && props.domain === "checkoutFields" && <label className="grid max-w-sm gap-1 text-sm"><span><LocalizedText value={"Store bill-handler rule"} /></span><NativeSelect value={requireHandlerOverride === null ? "inherit" : String(requireHandlerOverride)} onChange={(event) => setRequireHandlerOverride(event.target.value === "inherit" ? null : event.target.value === "true")}><option value="inherit"><LocalizedText value={"Use organisation setting"} /></option><option value="true"><LocalizedText value={"Require selection"} /></option><option value="false"><LocalizedText value={"Allow default cashier"} /></option></NativeSelect></label>}
    {isOrg ? <section className="grid gap-3">
      <div><h3 className="font-semibold"><LocalizedText value={"Organisation-defined fields"} /></h3><p className="text-xs text-muted-foreground"><LocalizedText value={"These product and variant fields are shared with every store and can only be changed here."} /></p></div>
      {orgConfig.fields.length === 0 ? <p className="border-y border-dashed py-4 text-sm text-muted-foreground"><LocalizedText value={"No extra fields yet. Add one when the catalogue needs more detail."} /></p> : orgConfig.fields.map((field) => <FieldEditor key={field.key} field={field} onChange={(patch) => setOrgField(field.key, patch)} onRemove={() => removeField(field.key)} allowScope={props.domain === "checkoutFields"} allowLevel={props.domain === "productFields"} domain={props.domain} canEdit={props.canEdit !== false} />)}
    </section> : <section className="grid gap-3">
      <div><h3 className="font-semibold"><LocalizedText value={"Fields defined by the organisation"} /></h3><p className="text-xs text-muted-foreground"><LocalizedText value={"Shared catalogue structure. Locked fields remain visible and cannot be removed by this store."} /></p></div>
      {definitions.length === 0 && <p className="border-y border-dashed py-4 text-sm text-muted-foreground"><LocalizedText value={"No active organisation fields yet."} /></p>}
      {definitions.map((field) => {
        const override = storeConfig.overrides[field.key] ?? {};
        return <div className="grid gap-2 border-y py-3" key={field.key}>
          <div className="flex flex-wrap items-center justify-between gap-2"><b>{field.label}</b><span className="text-xs text-muted-foreground">{field.type} <LocalizedText value={"· organisation-owned"} /><LocalizedText value={field.storeEditable ? " · editable here" : " · locked"} /></span></div>
          {field.storeEditable ? <>
            <label className="grid gap-1 text-sm"><LocalizedText value={"Store label"} /><Input value={override.label ?? field.label} onChange={(event) => setStoreConfig((current) => ({ ...current, overrides: { ...current.overrides, [field.key]: { ...current.overrides[field.key], label: event.target.value } } }))} /></label>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {props.domain === "checkoutFields" && <label className="flex items-center gap-2"><input type="checkbox" checked={override.active ?? field.active} onChange={(event) => setStoreConfig((current) => ({ ...current, overrides: { ...current.overrides, [field.key]: { ...current.overrides[field.key], active: event.target.checked } } }))} /> <LocalizedText value={"Show in this store"} /></label>}
              <label className="flex items-center gap-2"><input type="checkbox" checked={override.required ?? field.required} onChange={(event) => setStoreConfig((current) => ({ ...current, overrides: { ...current.overrides, [field.key]: { ...current.overrides[field.key], required: event.target.checked } } }))} /> <LocalizedText value={"Required in this store"} /></label>
            </div>
          </> : <p className="text-xs text-muted-foreground"><LocalizedText value={"This store cannot hide or remove this field."} /></p>}
        </div>;
      })}
    </section>}
    {!isOrg && <section className="grid gap-3 border-t pt-4">
      <div><h3 className="font-semibold"><LocalizedText value={"Store-only fields"} /></h3><p className="text-xs text-muted-foreground"><LocalizedText value={"These details are used only by this store and do not change the organisation definition."} /></p></div>
      {storeConfig.fields.length === 0 && <p className="border-y border-dashed py-4 text-sm text-muted-foreground"><LocalizedText value={"No store-only fields added."} /></p>}
      {storeConfig.fields.map((field) => <FieldEditor key={field.key} field={field} onChange={(patch) => setLocalField(field.key, patch)} onRemove={() => removeField(field.key)} allowScope={false} allowLevel={props.domain === "productFields"} domain={props.domain} />)}
    </section>}
    {(!isOrg && props.organisation?.allowStoreFields) || isOrg ? <Button variant="outline" className="w-fit" onClick={addField}><LocalizedText value={"Add "} /><LocalizedText value={props.domain === "checkoutFields" ? "checkout" : "product"} /> <LocalizedText value={"field"} /></Button> : null}
    <Button className="w-fit" onClick={() => void save()} disabled={busy || props.canEdit === false}><LocalizedText value={busy ? "Saving…" : props.domain === "checkoutFields" ? "Save checkout fields" : "Save product fields"} /></Button>
  </div>;
}

function FieldEditor({ field, onChange, onRemove, allowScope, allowLevel, domain, canEdit = true, open: controlledOpen, onOpenChange }: { field: ConfiguredField; onChange: (patch: Partial<ConfiguredField>) => void; onRemove: () => void; allowScope: boolean; allowLevel: boolean; domain: Props["domain"]; canEdit?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const t = useTranslate();
  const [localOpen, setLocalOpen] = React.useState(false);
  const open = controlledOpen ?? localOpen;
  const toggleOpen = (next: boolean) => controlledOpen === undefined ? setLocalOpen(next) : onOpenChange?.(next);
  return <div className="flex items-start gap-2 border-b p-3 last:border-b-0">
    <details open={open} onToggle={(event) => toggleOpen(event.currentTarget.open)} className="min-w-0 flex-1" aria-label={t("Field settings")}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/50"><span className="min-w-0"><b className="block truncate">{field.label || "New field"}</b><span className="text-xs text-muted-foreground">{field.type} · <LocalizedText value={field.active ? "Enabled" : "Disabled"} /><LocalizedText value={field.required ? " · Required" : ""} /><LocalizedText value={field.showOnReceipt ? " · On invoice" : ""} /></span></span><span className="shrink-0 text-xs font-medium text-primary"><LocalizedText value={open ? "Close" : "Edit field"} /></span></summary>
    <fieldset disabled={!canEdit} className="m-0 grid min-w-0 gap-3 border-0 p-0">
    <div className="grid gap-3 border-t p-3">
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-sm"><LocalizedText value={"Field key"} /><Input value={field.key} disabled /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Label"} /><Input value={field.label} onChange={(event) => onChange({ label: event.target.value })} /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Type"} /><NativeSelect value={field.type} onChange={(event) => onChange({ type: event.target.value as ConfiguredField["type"], options: event.target.value === "SELECT" && !field.options.length ? ["Option 1"] : field.options, defaultValue: undefined })}><option value="TEXT"><LocalizedText value={"Text"} /></option><option value="NUMBER"><LocalizedText value={"Number"} /></option><option value="DATE"><LocalizedText value={"Date"} /></option><option value="YESNO"><LocalizedText value={"Yes / no"} /></option><option value="SELECT"><LocalizedText value={"Select list"} /></option></NativeSelect></label>
      {field.type === "SELECT" && <label className="grid gap-1 text-sm"><LocalizedText value={"Options, comma-separated"} /><Input value={field.options.join(", ")} onChange={(event) => { const options = event.target.value.split(",").map((value) => value.trim()).filter(Boolean); onChange({ options, ...(typeof field.defaultValue === "string" && !options.includes(field.defaultValue) ? { defaultValue: undefined } : {}) }); }} /></label>}
      {field.type === "NUMBER" && <div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-sm"><LocalizedText value={"Minimum"} /><Input type="number" value={field.min ?? ""} onChange={(event) => onChange({ min: event.target.value === "" ? undefined : Number(event.target.value) })} /></label><label className="grid gap-1 text-sm"><LocalizedText value={"Maximum"} /><Input type="number" value={field.max ?? ""} onChange={(event) => onChange({ max: event.target.value === "" ? undefined : Number(event.target.value) })} /></label></div>}
      <label className="grid gap-1 text-sm"><LocalizedText value={"Default value"} />{field.type === "SELECT" ? <NativeSelect value={field.defaultValue === undefined ? "" : String(field.defaultValue)} onChange={(event) => onChange({ defaultValue: event.target.value || undefined })}><option value=""><LocalizedText value={"No default"} /></option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect> : field.type === "YESNO" ? <NativeSelect value={field.defaultValue === undefined ? "" : String(field.defaultValue)} onChange={(event) => onChange({ defaultValue: event.target.value === "" ? undefined : event.target.value === "true" })}><option value=""><LocalizedText value={"No default"} /></option><option value="true"><LocalizedText value={"Yes"} /></option><option value="false"><LocalizedText value={"No"} /></option></NativeSelect> : <Input type={field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"} min={field.type === "NUMBER" ? field.min : undefined} max={field.type === "NUMBER" ? field.max : undefined} value={field.defaultValue === undefined ? "" : String(field.defaultValue)} onChange={(event) => onChange({ defaultValue: event.target.value === "" ? undefined : field.type === "NUMBER" ? Number(event.target.value) : event.target.value })} />}</label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Help text"} /><Input maxLength={240} value={field.helpText ?? ""} onChange={(event) => onChange({ helpText: event.target.value })} /></label>
      {(allowScope || allowLevel) && <label className="grid gap-1 text-sm"><LocalizedText value={"Product field applies to"} /><NativeSelect value={field.level ?? "PRODUCT"} onChange={(event) => onChange({ level: event.target.value as "PRODUCT" | "VARIANT" })}><option value="PRODUCT"><LocalizedText value={"Product"} /></option><option value="VARIANT"><LocalizedText value={"Variant (SKU / barcode)"} /></option></NativeSelect></label>}
      <label className="grid gap-1 text-sm"><LocalizedText value={"Display order"} /><Input type="number" min={0} value={field.order} onChange={(event) => onChange({ order: Number(event.target.value) })} /></label>
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={field.active} onChange={(event) => onChange({ active: event.target.checked })} /> <LocalizedText value={"Enabled"} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={field.required} onChange={(event) => onChange({ required: event.target.checked })} /> <LocalizedText value={"Required"} /></label>
      {allowScope && <label className="flex items-center gap-2"><input type="checkbox" checked={field.storeEditable ?? false} onChange={(event) => onChange({ storeEditable: event.target.checked })} /> <LocalizedText value={"Store can customize"} /></label>}
      {domain === "checkoutFields" && <label className="flex items-center gap-2"><input type="checkbox" checked={field.showOnReceipt ?? false} onChange={(event) => onChange({ showOnReceipt: event.target.checked })} /> <LocalizedText value={"Show on invoice"} /></label>}
      {domain === "productFields" && allowScope && <label className="flex items-center gap-2"><input type="checkbox" checked={field.showInList ?? false} onChange={(event) => onChange({ showInList: event.target.checked })} /> <LocalizedText value={"Show in lists"} /></label>}
    </div>
    </div>
    </fieldset>
    </details>
    {canEdit && <Button type="button" variant="ghost" className="shrink-0 text-danger" onClick={onRemove}><LocalizedText value={"Remove"} /></Button>}
  </div>;
}

const STORE_CHECKOUT_FIELDS = ["customer", "coupon", "discount", "discountReason", "paymentReference", "splitTender", "itemNote", "billHandler", "tender", "cashTendered"];
const STORE_CHECKOUT_LABELS: Record<string, string> = { customer: "Customer picker", coupon: "Coupon code", discount: "Discount controls", discountReason: "Discount reason", paymentReference: "Payment reference", splitTender: "Split tender", itemNote: "Line note", billHandler: "Bill handler", tender: "Payment method", cashTendered: "Cash tendered" };
const STORE_CHECKOUT_HELP: Record<string, string> = {
  customer: "Attach a customer to the bill for purchase history and loyalty.",
  coupon: "Let the cashier enter a store offer or coupon code.",
  discount: "Show controls for permitted item and bill discounts.",
  discountReason: "Ask why a manual discount was applied.",
  paymentReference: "Record a UPI, card, or bank transaction reference.",
  splitTender: "Allow one bill to be paid with more than one method.",
  itemNote: "Add a note to an individual product line.",
  billHandler: "Choose the staff member responsible for the bill.",
  tender: "Choose how the customer pays. This stays available.",
  cashTendered: "Enter cash received and calculate change. This stays available.",
};
const REQUIRED_CHECKOUT_FIELDS: ConfiguredField[] = [];

/** Store-owned checkout field schema, with no organization defaults or override layer. */
export function StoreCheckoutFieldEditor({ storeId, initial, canEdit = true }: { storeId: string; initial: FieldSet; canEdit?: boolean }) {
  const router = useRouter();
  const [coreFields, setCoreFields] = React.useState<string[]>(initial.coreFields ?? STORE_CHECKOUT_FIELDS);
  const [fields, setFields] = React.useState<ConfiguredField[]>(initial.fields ?? REQUIRED_CHECKOUT_FIELDS);
  const [busy, setBusy] = React.useState(false);
  const [expandedFieldKey, setExpandedFieldKey] = React.useState<string | null>(null);
  const locked = new Set(["billHandler", "tender", "cashTendered"]);
  const add = () => {
    const key = `checkout_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    setExpandedFieldKey(key);
    setFields((current) => [...current, { key, label: "New checkout field", type: "TEXT", required: false, active: true, order: current.length * 10, helpText: "", options: [], storeEditable: false, showOnReceipt: false, showInList: false, level: "PRODUCT" }]);
  };
  async function save() {
    setBusy(true);
    try {
      const config: FieldSet = { version: 1, allowStoreFields: true, coreFields: [...new Set([...coreFields, ...locked])], fields: fields.map((field, order) => ({ ...field, order })) };
      await clientApi(`/admin/stores/${storeId}/settings`, { method: "PATCH", body: JSON.stringify({ checkoutFields: config }) });
      toast.success("Store checkout fields saved");
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save checkout fields"); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-4">
    <div><h2 className="font-semibold"><LocalizedText value={"Checkout fields"} /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={"Choose what cashiers see during checkout and what information is saved with each bill. Completed sales keep a snapshot of field labels and values."} /></p></div>
    <section className="grid gap-3 rounded-md border p-3">
      <div><h3 className="text-sm font-medium"><LocalizedText value={"Checkout controls"} /></h3><p className="text-xs text-muted-foreground"><LocalizedText value={"Turn optional controls on or off to simplify the cashier’s checkout screen. Payment method, cash tendered, and bill handler stay available."} /></p></div>
      <div className="grid gap-2 sm:grid-cols-2">{STORE_CHECKOUT_FIELDS.map((key) => <label key={key} className="flex items-start gap-2 rounded-md border p-3 text-sm"><input className="mt-0.5" type="checkbox" checked={coreFields.includes(key) || locked.has(key)} disabled={!canEdit || locked.has(key)} onChange={(event) => setCoreFields((current) => event.target.checked ? [...new Set([...current, key])] : current.filter((field) => field !== key))} /><span><b className="font-medium"><LocalizedText value={STORE_CHECKOUT_LABELS[key]} /></b><span className="mt-0.5 block text-xs text-muted-foreground"><LocalizedText value={STORE_CHECKOUT_HELP[key]} /></span></span></label>)}</div>
    </section>
    <section className="grid gap-2 rounded-md border p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-medium"><LocalizedText value={"Extra bill fields"} /></h3><p className="text-xs text-muted-foreground"><LocalizedText value={"Capture details such as delivery instructions, a gift note, or a reference number. Choose a field type, whether it is required, and if it appears on the invoice."} /></p></div>{canEdit && <Button type="button" variant="outline" className="w-fit shrink-0" onClick={add}><LocalizedText value={"Add checkout field"} /></Button>}</div>
      {fields.length ? <div className="divide-y rounded-md border">{fields.map((field) => <FieldEditor key={field.key} field={field} onChange={(patch) => setFields((current) => current.map((item) => item.key === field.key ? { ...item, ...patch } : item))} onRemove={() => { setFields((current) => current.filter((item) => item.key !== field.key)); if (expandedFieldKey === field.key) setExpandedFieldKey(null); }} allowScope={false} allowLevel={false} domain="checkoutFields" canEdit={canEdit} open={expandedFieldKey === field.key} onOpenChange={(open) => setExpandedFieldKey(open ? field.key : null)} />)}</div> : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"><LocalizedText value={"No extra bill fields yet. Add one when cashiers need to capture information beyond the standard checkout controls."} /></p>}
    </section>
    {canEdit && <Button className="w-fit" onClick={() => void save()} disabled={busy}><LocalizedText value={busy ? "Saving…" : "Save checkout fields"} /></Button>}
  </div>;
}

"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import { useState } from "react";
import { toast } from "@/lib/i18n/toast";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import type { ProductTypeAttribute, ProductTypeConfig, ProductTypeRow } from "@/features/api";

type Option = { id: string; name: string };
type Draft = { id?: string; name: string; description: string; status: "ACTIVE" | "DISABLED"; config: ProductTypeConfig; optionText: Record<number, string> };

const KINDS: [ProductTypeAttribute["kind"], string][] = [["TEXT", "Text"], ["NUMBER", "Number"], ["SELECT", "Choice list"], ["DATE", "Date"], ["YESNO", "Yes / no"]];
const emptyConfig = (): ProductTypeConfig => ({ categoryIds: [], brandIds: [], requireCategory: false, requireBrand: false, requireBarcode: false, attributes: [] });
const toDraft = (type?: ProductTypeRow): Draft => type
  ? { id: type.id, name: type.name, description: type.description, status: type.status, config: structuredClone(type.config), optionText: Object.fromEntries(type.config.attributes.map((a, i) => [i, a.options.join(", ")])) }
  : { name: "", description: "", status: "ACTIVE", config: emptyConfig(), optionText: {} };

function Pick({ legend, hint, options, selected, onChange }: { legend: string; hint: string; options: Option[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="grid gap-1.5">
    <legend className="text-sm font-medium">{legend}</legend>
    <p className="text-xs text-muted-foreground">{hint}</p>
    {options.length === 0 ? <p className="text-sm text-muted-foreground"><LocalizedText value={"None created yet."} /></p> : <div className="grid gap-1 sm:grid-cols-2">{options.map((option) => <label key={option.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(option.id)} onChange={(event) => onChange(event.target.checked ? [...selected, option.id] : selected.filter((id) => id !== option.id))} /> {option.name}</label>)}</div>}
  </fieldset>;
}

function Editor({ draft, setDraft, categories, brands, onSave, onCancel, busy }: { draft: Draft; setDraft: (d: Draft) => void; categories: Option[]; brands: Option[]; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const { config } = draft;
  const setConfig = (patch: Partial<ProductTypeConfig>) => setDraft({ ...draft, config: { ...config, ...patch } });
  const setAttribute = (index: number, patch: Partial<ProductTypeAttribute>) => setConfig({ attributes: config.attributes.map((a, i) => i === index ? { ...a, ...patch } : a) });
  const flag = (key: "requireCategory" | "requireBrand" | "requireBarcode", label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config[key]} onChange={(event) => setConfig({ [key]: event.target.checked })} /> {label}</label>;
  return <Card><CardContent className="grid gap-4">
    <h2 className="font-semibold">{draft.id ? `Edit ${draft.name || "setup rule"}` : "New product setup rule"}</h2>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm"><LocalizedText value={"Name"} /><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Packaged food" /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Description"} /><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    </div>
    <div className="grid gap-2"><p className="text-sm font-medium"><LocalizedText value={"Required for products using this rule"} /></p><div className="grid gap-1 sm:grid-cols-2">{flag("requireCategory", "a category")}{flag("requireBrand", "a brand")}{flag("requireBarcode", "a barcode on each variant")}</div></div>
    <Pick legend="Allowed categories" hint="Tick none to allow every category." options={categories} selected={config.categoryIds} onChange={(categoryIds) => setConfig({ categoryIds })} />
    <Pick legend="Allowed brands" hint="Tick none to allow every brand." options={brands} selected={config.brandIds} onChange={(brandIds) => setConfig({ brandIds })} />
    <div className="grid gap-2">
      <div><p className="text-sm font-medium"><LocalizedText value={"Extra fields"} /></p><p className="text-xs text-muted-foreground"><LocalizedText value={"Fields added to products using this rule, such as expiry date or warranty period."} /></p></div>
      {config.attributes.map((attribute, index) => <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1.2fr_auto_auto] sm:items-center">
        <Input aria-label="Field label" placeholder="Field label" value={attribute.label} onChange={(e) => setAttribute(index, { label: e.target.value, key: "" })} />
        <NativeSelect aria-label="Field kind" value={attribute.kind} onChange={(e) => setAttribute(index, { kind: e.target.value as ProductTypeAttribute["kind"] })}>{KINDS.map(([value, label]) => <option key={value} value={value}><LocalizedText value={label} /></option>)}</NativeSelect>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={attribute.required} onChange={(e) => setAttribute(index, { required: e.target.checked })} /> <LocalizedText value={"Required"} /></label>
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${attribute.label || "field"}`} onClick={() => setConfig({ attributes: config.attributes.filter((_, i) => i !== index) })}><Trash2 /></Button>
        {attribute.kind === "SELECT" && <Input className="sm:col-span-4" aria-label="Choices" placeholder="Choices, separated by commas" value={draft.optionText[index] ?? attribute.options.join(", ")} onChange={(e) => setDraft({ ...draft, optionText: { ...draft.optionText, [index]: e.target.value } })} />}
      </div>)}
      <Button type="button" variant="outline" className="w-fit" onClick={() => setConfig({ attributes: [...config.attributes, { key: "", label: "", kind: "TEXT", required: false, options: [] }] })}><Plus /> <LocalizedText value={"Add field"} /></Button>
    </div>
    {draft.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.status === "DISABLED"} onChange={(e) => setDraft({ ...draft, status: e.target.checked ? "DISABLED" : "ACTIVE" })} /> <LocalizedText value={"Switch this setup rule off (no new products can use it; existing products keep it)"} /></label>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}><LocalizedText value={"Cancel"} /></Button><Button onClick={onSave} disabled={busy}><LocalizedText value={busy ? "Saving…" : "Save setup rule"} /></Button></div>
  </CardContent></Card>;
}

export function ProductTypesManager({ types, categories, brands, canManage }: { types: ProductTypeRow[]; categories: Option[]; brands: Option[]; canManage: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) { toast.error("Give this setup rule a name."); return; }
    const attributes = draft.config.attributes.map((attribute, index) => ({ ...attribute, options: attribute.kind === "SELECT" ? (draft.optionText[index] ?? attribute.options.join(", ")).split(",").map((o) => o.trim()).filter(Boolean) : [] }));
    const body = { name: draft.name.trim(), description: draft.description.trim(), config: { ...draft.config, attributes }, ...(draft.id ? { status: draft.status } : {}) };
    setBusy(true);
    try {
      await clientApi(draft.id ? `/admin/catalog/product-types/${draft.id}` : "/admin/catalog/product-types", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(body) });
      toast.success("Product setup rule saved");
      window.location.reload();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the setup rule"); }
    finally { setBusy(false); }
  }
  const name = (list: Option[], ids: string[]) => ids.length ? ids.map((id) => list.find((o) => o.id === id)?.name ?? "—").join(", ") : "Any";
  return <div className="grid gap-4">
    {canManage && !draft && <Button className="w-fit" onClick={() => setDraft(toDraft())}><Plus /> <LocalizedText value={"New setup rule"} /></Button>}
    {draft && <Editor draft={draft} setDraft={setDraft} categories={categories} brands={brands} onSave={() => void save()} onCancel={() => setDraft(null)} busy={busy} />}
    {types.length === 0 && !draft && <Card><CardContent><p className="text-sm text-muted-foreground"><LocalizedText value={"No setup rules yet. You can create products without one. Add a rule when a product group needs a consistent product checklist, such as barcode requirements or extra attributes."} /></p></CardContent></Card>}
    <div className="grid gap-3">{types.map((type) => <Card key={type.id}><CardContent className="grid gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-semibold">{type.name} {type.status === "DISABLED" && <span className="ms-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"><LocalizedText value={"Switched off"} /></span>}</h3>{type.description && <p className="text-sm text-muted-foreground">{type.description}</p>}</div>
        {canManage && <Button variant="outline" size="sm" onClick={() => setDraft(toDraft(type))}><LocalizedText value={"Edit"} /></Button>}
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-muted-foreground"><LocalizedText value={"Products: "} /></dt><dd className="inline">{type.productCount}</dd></div>
        <div><dt className="inline text-muted-foreground"><LocalizedText value={"Categories: "} /></dt><dd className="inline">{name(categories, type.config.categoryIds)}</dd></div>
        <div><dt className="inline text-muted-foreground"><LocalizedText value={"Brands: "} /></dt><dd className="inline">{name(brands, type.config.brandIds)}</dd></div>
        <div><dt className="inline text-muted-foreground"><LocalizedText value={"Required: "} /></dt><dd className="inline">{[type.config.requireCategory && "category", type.config.requireBrand && "brand", type.config.requireBarcode && "barcode"].filter(Boolean).join(", ") || "nothing extra"}</dd></div>
        <div className="sm:col-span-2"><dt className="inline text-muted-foreground"><LocalizedText value={"Extra fields: "} /></dt><dd className="inline">{type.config.attributes.map((a) => `${a.label}${a.required ? "*" : ""}`).join(", ") || "none"}</dd></div>
      </dl>
    </CardContent></Card>)}</div>
  </div>;
}

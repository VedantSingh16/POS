"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import type { ProductTypeRow } from "@/features/api";

export type AttributeValues = Record<string, string | number | boolean>;

/** The categories / brands a type allows (all of them when the type lists none). */
export function allowedBy<T extends { id: string }>(type: ProductTypeRow | undefined, key: "categoryIds" | "brandIds", all: T[]): T[] {
  const ids = type?.config[key] ?? [];
  return ids.length ? all.filter((item) => ids.includes(item.id)) : all;
}

/** What a type's own fields need before the product can be saved; returns a message or null. */
export function missingAttribute(type: ProductTypeRow | undefined, values: AttributeValues): string | null {
  for (const attribute of type?.config.attributes ?? []) {
    const value = values[attribute.key];
    if (attribute.required && attribute.kind !== "YESNO" && (value === undefined || value === "")) return `${attribute.label} is required for ${type?.name} products`;
  }
  return null;
}

/** Optional product setup rule picker plus the extra fields that rule asks for. */
export function ProductTypeFields({ idPrefix, types, typeId, onTypeChange, values, onValuesChange, showType = true, showAttributes = true }: {
  idPrefix: string; types: ProductTypeRow[]; typeId: string; onTypeChange: (id: string) => void; values: AttributeValues; onValuesChange: (values: AttributeValues) => void; showType?: boolean; showAttributes?: boolean;
}) {
  const active = types.filter((type) => type.status === "ACTIVE" || type.id === typeId);
  const type = types.find((item) => item.id === typeId);
  if (!active.length && !typeId) return null;
  const set = (key: string, value: string | number | boolean) => onValuesChange({ ...values, [key]: value });
  return <>
    {showType && <Field label="Product setup rule (optional)" htmlFor={`${idPrefix}-type`}>
      <NativeSelect id={`${idPrefix}-type`} value={typeId} onChange={(event) => { onTypeChange(event.target.value); onValuesChange({}); }}>
        <option value=""><LocalizedText value={"No setup rule"} /></option>
        {active.map((item) => <option key={item.id} value={item.id}>{item.name}<LocalizedText value={item.status === "DISABLED" ? " (switched off)" : ""} /></option>)}
      </NativeSelect>
    </Field>}
    {type && (showType || showAttributes) && <p className="-mt-2 text-xs text-muted-foreground">{type.description || "Set by your organisation."} <LocalizedText value={type.config.requireBarcode ? "Every variant needs a barcode. " : ""} /><LocalizedText value={type.config.requireCategory ? "A category is required. " : ""} /><LocalizedText value={type.config.requireBrand ? "A brand is required." : ""} /></p>}
    {showAttributes && type?.config.attributes.map((attribute) => {
      const id = `${idPrefix}-attr-${attribute.key}`;
      const label = `${attribute.label}${attribute.required ? " *" : ""}`;
      const value = values[attribute.key];
      if (attribute.kind === "YESNO") return <label key={attribute.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value === true} onChange={(event) => set(attribute.key, event.target.checked)} /> {attribute.label}</label>;
      if (attribute.kind === "SELECT") return <Field key={attribute.key} label={label} htmlFor={id}><NativeSelect id={id} value={String(value ?? "")} onChange={(event) => set(attribute.key, event.target.value)}><option value=""><LocalizedText value={"Choose…"} /></option>{attribute.options.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect></Field>;
      return <Field key={attribute.key} label={label} htmlFor={id}><Input id={id} type={attribute.kind === "NUMBER" ? "number" : attribute.kind === "DATE" ? "date" : "text"} value={String(value ?? "")} onChange={(event) => set(attribute.key, attribute.kind === "NUMBER" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} /></Field>;
    })}
  </>;
}

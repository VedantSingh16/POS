"use client";

import { Input, NativeSelect } from "@/components/ui/input";

export type ConfiguredField = {
  key: string; label: string; type: "TEXT" | "NUMBER" | "DATE" | "YESNO" | "SELECT";
  required: boolean; active: boolean; order: number; helpText?: string; options: string[];
  min?: number; max?: number; defaultValue?: string | number | boolean; showOnReceipt?: boolean; showInList?: boolean; level?: "PRODUCT" | "VARIANT";
  storeEditable?: boolean;
};

export function ConfigurableFieldValues({ fields, values, onChange, idPrefix }: {
  fields: ConfiguredField[];
  values: Record<string, string | number | boolean>;
  onChange: (next: Record<string, string | number | boolean>) => void;
  idPrefix: string;
}) {
  const visible = fields.filter((field) => field.active).sort((a, b) => a.order - b.order);
  if (!visible.length) return null;
  const set = (key: string, value: string | number | boolean | undefined) => {
    const next = { ...values };
    if (value === undefined || value === "") delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return <div className="grid gap-3" aria-label="Configured fields">
    {visible.map((field) => {
      const id = `${idPrefix}-${field.key}`;
      const value = values[field.key] ?? field.defaultValue;
      const control = field.type === "SELECT"
        ? <NativeSelect id={id} required={field.required} value={typeof value === "string" ? value : ""} onChange={(event) => set(field.key, event.target.value)}><option value="">Choose…</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</NativeSelect>
        : field.type === "YESNO"
          ? <NativeSelect id={id} required={field.required} value={typeof value === "boolean" ? String(value) : ""} onChange={(event) => set(field.key, event.target.value === "" ? undefined : event.target.value === "true")}><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></NativeSelect>
          : <Input id={id} required={field.required} type={field.type === "NUMBER" ? "number" : field.type === "DATE" ? "date" : "text"} min={field.type === "NUMBER" ? field.min : undefined} max={field.type === "NUMBER" ? field.max : undefined} value={value === undefined ? "" : String(value)} onChange={(event) => set(field.key, event.target.value === "" ? undefined : field.type === "NUMBER" ? Number(event.target.value) : event.target.value)} />;
      return <label className="grid gap-1 text-sm" htmlFor={id} key={field.key}>
        <span className="font-medium">{field.label}{field.required ? " *" : ""}</span>
        {control}
        {field.helpText && <span className="text-xs text-muted-foreground">{field.helpText}</span>}
      </label>;
    })}
  </div>;
}

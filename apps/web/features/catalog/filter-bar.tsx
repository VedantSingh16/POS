"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { useTranslate } from "@/components/i18n/localized-text";

export type FilterSpec = { key: string; label: string; allLabel: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void };

/** A compact "Filters" button with a dropdown panel, active-filter chips and Clear all. Never stretches the table header. */
export function FilterBar({ filters }: { filters: FilterSpec[] }) {
  const t = useTranslate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const active = filters.filter((filter) => filter.value);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="flex flex-wrap items-center gap-2" ref={ref}>
      <div className="relative">
        <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
          <ListFilter /> <LocalizedText value={"Filters"} />{active.length > 0 && <span className="ms-1 grid size-5 place-items-center rounded-full bg-primary text-xs text-primary-foreground">{active.length}</span>}
        </Button>
        {open && <div role="dialog" aria-label={t("Filters")} className="absolute start-0 top-full z-30 mt-2 grid w-[min(30rem,calc(100vw-2rem))] gap-3 rounded-lg border bg-popover p-4 shadow-lg sm:grid-cols-2">
          {filters.map((filter) => <label key={filter.key} className="grid gap-1 text-xs font-medium text-muted-foreground"><LocalizedText value={filter.label} />
            <NativeSelect aria-label={`${t("Filter by")} ${t(filter.label)}`} value={filter.value} onChange={(event) => filter.onChange(event.target.value)}>
              <option value=""><LocalizedText value={filter.allLabel} /></option>{filter.options.map((option) => <option key={option.value} value={option.value}><LocalizedText value={option.label} /></option>)}
            </NativeSelect></label>)}
          <div className="flex items-center justify-between sm:col-span-2">
            <Button type="button" variant="ghost" size="sm" disabled={active.length === 0} onClick={() => filters.forEach((filter) => filter.onChange(""))}><LocalizedText value={"Clear all"} /></Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}><LocalizedText value={"Done"} /></Button>
          </div>
        </div>}
      </div>
      {active.map((filter) => <button key={filter.key} type="button" onClick={() => filter.onChange("")} className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 text-xs hover:bg-accent" aria-label={`${t("Remove")} ${t(filter.label)} ${t("filter")}`}>
        <LocalizedText value={filter.label} />: <b><LocalizedText value={filter.options.find((option) => option.value === filter.value)?.label ?? filter.value} /></b> <X className="size-3" /></button>)}
    </div>
  );
}

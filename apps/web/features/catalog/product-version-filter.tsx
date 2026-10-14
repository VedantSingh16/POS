"use client";
import { NativeSelect } from "@/components/ui/input";

export type ProductVersionOption = { id: string; name: string };
export function ProductVersionFilter({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: ProductVersionOption[] }) {
  return <label className="flex items-center gap-2 text-xs text-muted-foreground"><span className="whitespace-nowrap">Product version</span><NativeSelect aria-label="Filter by product version" className="h-9 min-w-40" value={value} onChange={(event) => onChange(event.target.value)}><option value="">All versions</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</NativeSelect></label>;
}

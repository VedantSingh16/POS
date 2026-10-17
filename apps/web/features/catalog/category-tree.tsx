"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LocalizedText } from "@/components/i18n/localized-text";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { toast } from "@/lib/i18n/toast";
import { clientApi } from "@/features/client-api";
import type { CategoryRow } from "@/features/types";

export function CategoryTree({ categories, canManage }: { categories: CategoryRow[]; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({ name: "", parentId: "", status: "ACTIVE" });
  const [busy, setBusy] = React.useState(false);
  const byParent = new Map<string, CategoryRow[]>();
  for (const category of categories) {
    const key = category.parentId ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), category]);
  }
  const options = categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await clientApi("/admin/catalog/categories", { method: "POST", body: JSON.stringify({ name: name.trim(), parentId: parentId || null }) });
      setName(""); setParentId(""); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create category"); }
    finally { setBusy(false); }
  }

  async function save(id: string) {
    setBusy(true);
    try {
      await clientApi(`/admin/catalog/categories/${id}`, { method: "PATCH", body: JSON.stringify({ name: draft.name.trim(), parentId: draft.parentId || null, status: draft.status }) });
      setEditing(null); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update category"); }
    finally { setBusy(false); }
  }

  function nodes(parent: string, depth: number, visited: Set<string>): React.ReactNode {
    return (byParent.get(parent) ?? []).filter((item) => !visited.has(item.id)).map((item) => {
      const next = new Set(visited).add(item.id);
      return <li key={item.id} className="border-s-2 border-border ps-4" style={{ marginInlineStart: `${depth * 12}px` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
          {editing === item.id ? <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Category name" value={draft.name} onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))} />
            <NativeSelect aria-label="Parent category" value={draft.parentId} onChange={(event) => setDraft((old) => ({ ...old, parentId: event.target.value }))}><option value="">Top level</option>{options}</NativeSelect>
            <NativeSelect aria-label="Category status" value={draft.status} onChange={(event) => setDraft((old) => ({ ...old, status: event.target.value }))}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></NativeSelect>
            <Button size="sm" disabled={busy || !draft.name.trim()} onClick={() => void save(item.id)}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          </div> : <div><b className="text-sm">{item.name}</b>{item.status === "DISABLED" && <span className="ms-2 text-xs text-muted-foreground">Disabled</span>}<p className="text-xs text-muted-foreground">{item.products} <LocalizedText value={"products"} /></p></div>}
          {editing !== item.id && <div className="flex items-center gap-3 text-sm"><Link className="text-primary underline" href={`/org/catalog/products?categoryId=${item.id}`}><LocalizedText value={"View products"} /></Link>{canManage && <button className="underline" onClick={() => { setDraft({ name: item.name, parentId: item.parentId ?? "", status: item.status ?? "ACTIVE" }); setEditing(item.id); }}>Edit</button>}</div>}
        </div>
        {nodes(item.id, depth + 1, next)}
      </li>;
    });
  }

  const roots = categories.filter((category) => !category.parentId || !categories.some((other) => other.id === category.parentId));
  return <div className="grid gap-5">
    {canManage && <form className="flex flex-wrap items-end gap-3 rounded-md border p-4" onSubmit={(event) => void create(event)}>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Category name"} /><Input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label className="grid gap-1 text-sm"><LocalizedText value={"Parent category"} /><NativeSelect value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Top level</option>{options}</NativeSelect></label>
      <Button disabled={busy || !name.trim()} type="submit"><LocalizedText value={"Add category"} /></Button>
    </form>}
    {roots.length ? <ul className="grid">{nodes("", 0, new Set())}{roots.filter((root) => root.parentId && !categories.some((other) => other.id === root.parentId)).map((root) => nodes(root.parentId!, 0, new Set()))}</ul> : <p className="rounded-md border border-dashed p-8 text-sm text-muted-foreground"><LocalizedText value={"No categories yet. Add one to organise products."} /></p>}
  </div>;
}

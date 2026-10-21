"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { LocalizedText } from "@/components/i18n/localized-text";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/form/dialogs";
import { toast } from "@/lib/i18n/toast";
import { clientApi } from "@/features/client-api";
import type { CategoryRow } from "@/features/types";

export function CategoryTree({ categories, canManage }: { categories: CategoryRow[]; canManage: boolean }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState({ name: "", parentId: "", status: "ACTIVE", includeSubcategories: false });
  const [busy, setBusy] = React.useState(false);
  const byParent = new Map<string, CategoryRow[]>();
  for (const category of categories) {
    const key = category.parentId ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), category]);
  }
  const byId = new Map(categories.map((category) => [category.id, category]));
  const options = categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.status === "DISABLED" ? " (disabled)" : ""}</option>);

  /** Every category below `id`, at any depth (cycle-safe). */
  const descendantsOf = (id: string) => {
    const found = new Set<string>();
    const queue = [...(byParent.get(id) ?? [])];
    while (queue.length) {
      const next = queue.shift()!;
      if (next.id === id || found.has(next.id)) continue;
      found.add(next.id);
      queue.push(...(byParent.get(next.id) ?? []));
    }
    return [...found].map((childId) => byId.get(childId)!).filter(Boolean);
  };
  const parentDisabled = (id: string | null | undefined) => Boolean(id && byId.get(id)?.status === "DISABLED");

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

  async function save(item: CategoryRow) {
    setBusy(true);
    try {
      await clientApi(`/admin/catalog/categories/${item.id}`, { method: "PATCH", body: JSON.stringify({ name: draft.name.trim(), parentId: draft.parentId || null, status: draft.status, ...(draft.status === "ACTIVE" && item.status === "DISABLED" ? { includeSubcategories: draft.includeSubcategories } : {}) }) });
      if (draft.status === "DISABLED" && item.status !== "DISABLED" && descendantsOf(item.id).length) toast.success("Category and its subcategories disabled");
      setEditing(null); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update category"); }
    finally { setBusy(false); }
  }

  async function remove(item: CategoryRow) {
    setBusy(true);
    try {
      await clientApi(`/admin/catalog/categories/${item.id}`, { method: "DELETE" });
      toast.success("Category deleted");
      if (editing === item.id) setEditing(null);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete category"); }
    finally { setBusy(false); }
  }

  function nodes(parent: string, depth: number, visited: Set<string>): React.ReactNode {
    return (byParent.get(parent) ?? []).filter((item) => !visited.has(item.id)).map((item) => {
      const next = new Set(visited).add(item.id);
      const descendants = descendantsOf(item.id);
      const productsInTree = item.products + descendants.reduce((sum, child) => sum + child.products, 0);
      const lockedByParent = parentDisabled(draft.parentId);
      return <li key={item.id} className="border-s-2 border-border ps-4" style={{ marginInlineStart: `${depth * 12}px` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
          {editing === item.id ? <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Category name" value={draft.name} onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))} />
              <NativeSelect aria-label="Parent category" value={draft.parentId} onChange={(event) => setDraft((old) => ({ ...old, parentId: event.target.value, status: parentDisabled(event.target.value) ? "DISABLED" : old.status }))}><option value="">Top level</option>{options}</NativeSelect>
              <NativeSelect aria-label="Category status" value={lockedByParent ? "DISABLED" : draft.status} disabled={lockedByParent} title={lockedByParent ? "Enable the parent category first" : undefined} onChange={(event) => setDraft((old) => ({ ...old, status: event.target.value }))}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></NativeSelect>
              <Button size="sm" disabled={busy || !draft.name.trim()} onClick={() => void save(item)}><LocalizedText value={"Save"} /></Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}><LocalizedText value={"Cancel"} /></Button>
            </div>
            {lockedByParent && <p className="text-xs text-muted-foreground"><LocalizedText value={"The parent category is disabled, so this category stays disabled until the parent is enabled."} /></p>}
            {!lockedByParent && draft.status === "DISABLED" && item.status !== "DISABLED" && descendants.length > 0 && <p className="text-xs text-warning"><LocalizedText value={"All subcategories will be disabled as well."} /></p>}
            {!lockedByParent && draft.status === "ACTIVE" && item.status === "DISABLED" && descendants.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={draft.includeSubcategories} onChange={(event) => setDraft((old) => ({ ...old, includeSubcategories: event.target.checked }))} /><LocalizedText value={"Also enable all subcategories"} /></label>}
          </div> : <div><b className="text-sm">{item.name}</b>{item.status === "DISABLED" && <span className="ms-2 text-xs text-muted-foreground"><LocalizedText value={parentDisabled(item.parentId) ? "Disabled (parent disabled)" : "Disabled"} /></span>}<p className="text-xs text-muted-foreground">{item.products} <LocalizedText value={"products"} /></p></div>}
          {editing !== item.id && <div className="flex items-center gap-3 text-sm">
            <Link className="text-primary underline" href={`/org/catalog/products?categoryId=${item.id}`}><LocalizedText value={"View products"} /></Link>
            {canManage && <button type="button" className="underline" onClick={() => { setDraft({ name: item.name, parentId: item.parentId ?? "", status: item.status ?? "ACTIVE", includeSubcategories: false }); setEditing(item.id); }}><LocalizedText value={"Edit"} /></button>}
            {canManage && (productsInTree > 0
              ? <button type="button" className="inline-flex cursor-not-allowed items-center gap-1 text-muted-foreground opacity-60" disabled title="Move its products to another category before deleting it"><Trash2 className="size-3.5" aria-hidden /><LocalizedText value={"Delete"} /></button>
              : <ConfirmDialog destructive confirmLabel="Delete" title={`Delete ${item.name}?`} description={descendants.length ? `Its ${descendants.length} subcategories will be deleted too. This cannot be undone.` : "This cannot be undone."} onConfirm={() => void remove(item)} trigger={<button type="button" disabled={busy} className="inline-flex items-center gap-1 text-danger underline"><Trash2 className="size-3.5" aria-hidden /><LocalizedText value={"Delete"} /></button>} />)}
          </div>}
        </div>
        {(byParent.get(item.id) ?? []).length > 0 && <ul className="grid">{nodes(item.id, depth + 1, next)}</ul>}
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

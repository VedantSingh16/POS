"use client";
import { LocalizedText, useTranslate } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type SortingState, type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DropdownMenu as M } from "radix-ui";
import { EmptyState, ErrorState } from "./primitives";

type Props<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Row link, e.g. (row) => `/org/users/${row.id}`. */
  rowHref?: (row: T) => string;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  loading?: boolean;
  error?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
  initialVisibility?: VisibilityState;
};

/** One table for every list in the product. Client-side paging here; swap to server-side with manualPagination in Phase 2+. */
export function DataTable<T>({ columns, data, rowHref, searchPlaceholder = "Search…", toolbar, loading, error, emptyTitle = "Nothing here yet", emptyDescription, pageSize = 10, initialVisibility }: Props<T>) {
  const t = useTranslate();
  const router = useRouter();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [filter, setFilter] = React.useState("");
  const [visibility, setVisibility] = React.useState<VisibilityState>(initialVisibility ?? {});
  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter: filter, columnVisibility: visibility },
    onSortingChange: setSorting, onGlobalFilterChange: setFilter, onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });
  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border p-3 sm:p-4">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground" />
          <Input aria-label="Search table" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={searchPlaceholder} className="ps-8!" />
        </div>
        {toolbar}
        <div className="ms-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm"><Columns3 /> <LocalizedText value={"Columns"} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table.getAllLeafColumns().filter((c) => c.getCanHide() && !(typeof c.columnDef.header === "string" && c.columnDef.header === "")).map((c) => (
                <M.CheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} onSelect={(e) => e.preventDefault()}
                  className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-accent">
                  <span className="grid size-4 shrink-0 place-items-center text-primary"><LocalizedText value={c.getIsVisible() ? "✓" : ""} /></span><LocalizedText value={typeof c.columnDef.header === "string" ? c.columnDef.header : c.id} />
                </M.CheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error ? <ErrorState description={error} /> : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  return (
                    <TableHead key={h.id} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                      {h.isPlaceholder ? null : h.column.getCanSort() ? (
                        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                          {typeof h.column.columnDef.header === "string" ? <LocalizedText value={h.column.columnDef.header} /> : flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                        </button>
                      ) : typeof h.column.columnDef.header === "string" ? <LocalizedText value={h.column.columnDef.header} /> : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? Array.from({ length: 5 }, (_, i) => (
              <TableRow key={i}>{table.getVisibleLeafColumns().map((c) => <TableCell key={c.id}><Skeleton className="h-4 w-full max-w-32" /></TableCell>)}</TableRow>
            )) : rows.map((row) => (
              <TableRow key={row.id} data-clickable={!!rowHref}
                onClick={rowHref ? () => router.push(rowHref(row.original)) : undefined}
                onKeyDown={rowHref ? (e) => { if (e.key === "Enter") router.push(rowHref(row.original)); } : undefined}
                tabIndex={rowHref ? 0 : undefined}>
                {row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!loading && !error && rows.length === 0 && <EmptyState title={filter ? "No matches" : emptyTitle} description={filter ? "Try a different search term." : emptyDescription} />}

      {total > 0 && <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <span className="tabular">{total} <LocalizedText value={total === 1 ? "row" : "rows"} /></span>
        {table.getPageCount() > 1 && <div className="flex items-center gap-2">
          <span className="tabular me-1"><LocalizedText value={"Page "} />{table.getState().pagination.pageIndex + 1} <LocalizedText value={"of "} />{table.getPageCount()}</span>
          <Button variant="outline" size="icon-sm" aria-label={t("Previous page")} onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft className="rtl:rotate-180" /></Button>
          <Button variant="outline" size="icon-sm" aria-label={t("Next page")} onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}><ChevronRight className="rtl:rotate-180" /></Button>
        </div>}
      </div>}
    </div>
  );
}

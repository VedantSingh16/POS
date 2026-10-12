"use client";
/* Held-sale payloads are persisted JSON and are narrowed when they are resumed. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Download, List, Minus, PauseCircle, Plus, ScanBarcode, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Money } from "@/components/data/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/features/types";
import { IdleLock, UserMenu } from "@/components/app/user-menu";
import { useMe } from "@/components/app/session-context";
import { clientApi } from "@/features/client-api";
import { useRouter } from "next/navigation";

type PosProduct = Product & { variantId?: string; barcodes?: string[]; brand?: string; includesTax?: boolean };
type Line = { product: PosProduct; qty: number; note: string; discountCents: number };
type Customer = { id: string; name: string; phone?: string };
type Quote = { subtotalCents: number; discountCents: number; chargeCents: number; charges: { id: string; name: string; amountCents: number; taxCents: number }[]; taxCents: number; totalCents: number };
type Done = { id: string; receiptNumber: string; totalCents: number; changeCents: number };

type Props = {
  storeId: string;
  storeName: string;
  cashier: string;
  products: PosProduct[];
  categories: string[];
  canExit: boolean;
  registers: { id: string; name: string; sessionId: string; status: string; active?: boolean }[];
  customers: Customer[];
  /** Messages for parts of the screen that could not be loaded (the rest of the screen still works). */
  loadProblems?: string[];
};

const keyOf = (product: PosProduct) => product.variantId ?? product.id;

/** Local estimate shown only until the server's price arrives. The server figure is what is charged. */
function estimate(lines: Line[]): Quote {
  let subtotal = 0; let tax = 0; let discount = 0;
  for (const line of lines) {
    const gross = Math.max(0, line.product.priceMinor * line.qty - line.discountCents);
    const rate = line.product.taxRate;
    const lineTax = line.product.includesTax ? Math.round((gross * rate) / (100 + rate)) : Math.round((gross * rate) / 100);
    subtotal += line.product.includesTax ? gross - lineTax : gross; tax += lineTax; discount += line.discountCents;
  }
  return { subtotalCents: subtotal, discountCents: discount, chargeCents: 0, charges: [], taxCents: tax, totalCents: subtotal + tax };
}

export function PosScreen({ storeId, storeName, cashier, products: productsIn, categories, canExit, registers, customers, loadProblems = [] }: Props) {
  const router = useRouter();
  const [products, setProducts] = React.useState<PosProduct[]>(productsIn);
  React.useEffect(() => setProducts(productsIn), [productsIn]);
  const me = useMe();
  const canAddRegister = me.permissions.organization.includes("registers.manage");
  const usableRegisters = registers.filter((r) => r.active !== false);
  const [category, setCategory] = React.useState("Quick keys");
  const [query, setQuery] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>([]);
  const [payOpen, setPayOpen] = React.useState(false);
  const [browseOpen, setBrowseOpen] = React.useState(false);
  const [browseQuery, setBrowseQuery] = React.useState("");
  const [browseCategory, setBrowseCategory] = React.useState("");
  const [holdsOpen, setHoldsOpen] = React.useState(false);
  const [holds, setHolds] = React.useState<{ id: string; payload: any; createdAt: string }[]>([]);
  const [tender, setTender] = React.useState<"CASH" | "CARD" | "UPI">("CASH");
  const [cashTendered, setCashTendered] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [customerId, setCustomerId] = React.useState("");
  const [customerOptions, setCustomerOptions] = React.useState(customers);
  const [customerCreateOpen, setCustomerCreateOpen] = React.useState(false);
  const [newCustomerName, setNewCustomerName] = React.useState("");
  const [newCustomerPhone, setNewCustomerPhone] = React.useState("");
  const [discount, setDiscount] = React.useState("");
  const [discountReason, setDiscountReason] = React.useState("");
  const [managerPin, setManagerPin] = React.useState("");
  const [approvalNeeded, setApprovalNeeded] = React.useState(false);
  const [splitTender, setSplitTender] = React.useState<"NONE" | "CARD" | "UPI">("NONE");
  const [splitAmount, setSplitAmount] = React.useState("");
  const [sessionId, setSessionId] = React.useState(usableRegisters.find((r) => r.status === "OPEN")?.sessionId ?? "");
  const [registerId, setRegisterId] = React.useState(usableRegisters.find((r) => r.status === "OPEN")?.id ?? usableRegisters.find((r) => r.status !== "OPEN")?.id ?? "");
  const [openTill, setOpenTill] = React.useState(!sessionId);
  const [openingFloat, setOpeningFloat] = React.useState("0");
  const [busy, setBusy] = React.useState(false);
  const [quote, setQuote] = React.useState<Quote | null>(null);
  const [quoteError, setQuoteError] = React.useState("");
  const [quoting, setQuoting] = React.useState(false);
  const [done, setDone] = React.useState<Done | null>(null);
  const [scanFlash, setScanFlash] = React.useState<"" | "ok" | "miss">("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const quoteSeq = React.useRef(0);

  const orderDiscountCents = Math.max(0, Math.round(Number(discount || 0) * 100));

  /* ── Server price for the cart: the same calculation the sale and the invoice use ── */
  React.useEffect(() => {
    if (!lines.length) { setQuote(null); setQuoteError(""); setQuoting(false); return; }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const result = await clientApi<Quote>("/pos/v1/sales/quote", { method: "POST", body: JSON.stringify({ storeId, discountCents: orderDiscountCents, lines: lines.map((line) => ({ variantId: keyOf(line.product), quantity: line.qty, discountCents: line.discountCents || undefined })) }) });
        if (seq === quoteSeq.current) { setQuote(result); setQuoteError(""); }
      } catch (error) {
        if (seq === quoteSeq.current) { setQuote(null); setQuoteError(error instanceof Error ? error.message : "Could not price this bill"); }
      } finally { if (seq === quoteSeq.current) setQuoting(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [lines, orderDiscountCents, storeId]);

  const totals = quote ?? estimate(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const total = totals.totalCents - (quote ? 0 : orderDiscountCents);
  const priced = Boolean(quote) && !quoting;

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => q ? p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q) || p.barcode.includes(q) || p.barcodes?.some((barcode) => barcode.toLowerCase().includes(q)) : category === "Quick keys" ? p.hot : p.category === category);
  }, [products, query, category]);

  const add = React.useCallback((product: PosProduct) => {
    if (product.stock <= 0) { toast.warning(`${product.name} is out of stock`); return false; }
    setLines((current) => {
      const index = current.findIndex((line) => keyOf(line.product) === keyOf(product));
      if (index === -1) return [...current, { product, qty: 1, note: "", discountCents: 0 }];
      return current.map((line, i) => i === index ? { ...line, qty: Math.min(line.qty + 1, product.stock) } : line);
    });
    return true;
  }, []);
  const setQty = (id: string, delta: number) => setLines((current) => current.flatMap((line) => keyOf(line.product) !== id ? [line] : line.qty + delta <= 0 ? [] : [{ ...line, qty: Math.min(line.qty + delta, line.product.stock) }]));
  const remove = (id: string) => setLines((current) => current.filter((line) => keyOf(line.product) !== id));
  const setLineNote = (id: string, note: string) => setLines((current) => current.map((line) => keyOf(line.product) === id ? { ...line, note } : line));
  const setLineDiscount = (id: string, value: string) => setLines((current) => current.map((line) => keyOf(line.product) === id ? { ...line, discountCents: Math.max(0, Math.min(line.product.priceMinor * line.qty, Math.round(Number(value || 0) * 100))) } : line));

  /* ── Way 1: barcode scan. A scanner types the code and presses Enter. ── */
  async function scan(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const code_ = code.toLowerCase();
    let found = products.find((p) => p.barcode === code || p.barcodes?.includes(code) || p.sku.toLowerCase() === code_);
    if (!found) {
      // The screen only holds the first products of a large catalogue: ask the server for this exact code.
      try {
        const result = await clientApi<{ products: any[] }>(`/pos/v1/catalog/search?storeId=${encodeURIComponent(storeId)}&q=${encodeURIComponent(code)}`);
        const hit = (result.products ?? []).find((p) => p.barcode === code || (p.barcodes ?? []).includes(code) || String(p.sku).toLowerCase() === code_) ?? ((result.products ?? []).length === 1 ? result.products[0] : undefined);
        if (hit) {
          found = { id: hit.variantId, variantId: hit.variantId, sku: hit.sku ?? "", barcode: hit.barcode ?? "", barcodes: hit.barcodes ?? [], name: hit.variantName && hit.variantName !== hit.productName ? `${hit.productName} · ${hit.variantName}` : hit.productName, category: hit.categoryName || "Uncategorised", brand: hit.brand ?? "", priceMinor: hit.priceCents ?? 0, includesTax: hit.includesTax === true, taxRate: (hit.taxBps ?? 0) / 100, stock: hit.stock ?? 0, status: "ACTIVE", hot: true };
          setProducts((current) => current.some((p) => keyOf(p) === keyOf(found!)) ? current : [...current, found!]);
        }
      } catch { /* shown below as "not found" */ }
    }
    if (found && add(found)) { setScanFlash("ok"); setQuery(""); }
    else if (!found) { setScanFlash("miss"); toast.error(`No product in this store matches “${code}”`); }
    setTimeout(() => setScanFlash(""), 600);
  }

  const searchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const typed = query.trim();
    if (!typed) return;
    // Exactly one filtered tile and it is not a code: add it. Otherwise treat the text as a scanned/typed code.
    const exact = products.some((p) => p.barcode === typed || p.barcodes?.includes(typed) || p.sku.toLowerCase() === typed.toLowerCase());
    if (!exact && visible.length === 1) { add(visible[0]!); setQuery(""); return; }
    void scan(typed).then(() => setQuery(""));
  };

  const hold = React.useCallback(async () => {
    if (!registerId) return;
    setBusy(true);
    try {
      await clientApi("/pos/v1/holds", { method: "POST", body: JSON.stringify({ storeId, registerId, payload: { lines: lines.map((line) => ({ variantId: keyOf(line.product), quantity: line.qty, note: line.note, discountCents: line.discountCents })) } }) });
      setLines([]); toast.success("Sale held");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not hold sale"); }
    finally { setBusy(false); }
  }, [lines, registerId, storeId]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      const dialogOpen = Boolean(document.querySelector("[role=dialog]"));
      if ((event.key === "/" || event.key === "F2") && !typing) { event.preventDefault(); searchRef.current?.focus(); }
      // A scanner types into the page even when nothing is focused: send those keystrokes to the scan box.
      else if (!typing && !dialogOpen && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) searchRef.current?.focus();
      if ((event.key === "F12" || (event.ctrlKey && event.key === "Enter")) && lines.length) { event.preventDefault(); setPayOpen(true); }
      if (event.key === "Delete" && lines.length && !typing) { event.preventDefault(); remove(keyOf(lines.at(-1)!.product)); }
      if (event.key === "F4" && lines.length) { event.preventDefault(); void hold(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hold, lines]);

  async function openSession() {
    if (!registerId) { toast.error("Create a register before opening the till"); return; }
    setBusy(true);
    try {
      const session = await clientApi<{ id: string }>("/pos/v1/sessions", { method: "POST", body: JSON.stringify({ storeId, registerId, openingFloatCents: Math.round(Number(openingFloat || 0) * 100) }) });
      setSessionId(session.id); setOpenTill(false); toast.success("Register opened. You can start selling.");
      setTimeout(() => searchRef.current?.focus(), 100);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not open till"); }
    finally { setBusy(false); }
  }

  async function loadHolds() {
    try { const result = await clientApi<{ holds: typeof holds }>(`/pos/v1/holds?storeId=${encodeURIComponent(storeId)}`); setHolds(result.holds ?? []); setHoldsOpen(true); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load held sales"); }
  }

  async function resume(holdId: string) {
    try {
      const result = await clientApi<{ payload?: { lines?: { variantId: string; quantity: number; note?: string; discountCents?: number }[] } }>(`/pos/v1/holds/${holdId}/resume`, { method: "POST", headers: { "x-store-id": storeId } });
      const resumed = result.payload?.lines ?? [];
      setLines(resumed.flatMap((item) => { const product = products.find((candidate) => keyOf(candidate) === item.variantId || candidate.id === item.variantId); return product ? [{ product, qty: item.quantity, note: item.note ?? "", discountCents: item.discountCents ?? 0 }] : []; }));
      setHoldsOpen(false); toast.success("Held sale resumed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not resume held sale"); }
  }

  async function complete() {
    if (!sessionId || !registerId) { toast.error("Open a register before taking payment"); return; }
    if (!quote) { toast.error(quoteError || "The bill is still being priced. Try again in a moment."); return; }
    const checkoutTotal = quote.totalCents;
    setBusy(true);
    try {
      const splitCents = splitTender === "NONE" ? 0 : Math.round(Number(splitAmount || 0) * 100);
      if (splitTender !== "NONE" && (splitCents <= 0 || splitCents >= checkoutTotal)) { toast.error("Enter a split amount smaller than the total"); return; }
      const tenderedCents = tender === "CASH" && cashTendered ? Math.round(Number(cashTendered) * 100) : undefined;
      if (splitTender === "NONE" && tenderedCents !== undefined && tenderedCents < checkoutTotal) { toast.error(`Cash tendered is less than the total (${formatMoney(checkoutTotal)})`); return; }
      const payments = splitTender === "NONE"
        ? [{ tenderType: tender, amountCents: checkoutTotal, ...(tenderedCents !== undefined ? { tenderedCents } : {}), reference }]
        : [{ tenderType: tender, amountCents: splitCents, reference }, { tenderType: splitTender, amountCents: checkoutTotal - splitCents, reference }];
      const result = await clientApi<{ sale?: { id: string; receiptNumber?: string; totalCents: number; payments?: { changeCents?: number }[] } }>("/pos/v1/sales", { method: "POST", body: JSON.stringify({ storeId, registerId, sessionId, customerId: customerId || undefined, discountCents: orderDiscountCents, discountReason: discountReason || undefined, managerPin: managerPin || undefined, clientSaleId: crypto.randomUUID(), lines: lines.map((line) => ({ variantId: keyOf(line.product), quantity: line.qty, note: line.note || undefined, discountCents: line.discountCents || undefined, discountReason: line.discountCents ? discountReason || undefined : undefined })), payments }) });
      // Deduct sold quantities from the on-screen stock immediately, then refresh from the server.
      const soldByVariant = new Map<string, number>();
      for (const line of lines) soldByVariant.set(keyOf(line.product), (soldByVariant.get(keyOf(line.product)) ?? 0) + line.qty);
      setProducts((current) => current.map((p) => { const sold = soldByVariant.get(keyOf(p)) ?? 0; return sold ? { ...p, stock: Math.max(0, (p.stock ?? 0) - sold) } : p; }));
      const sale = result.sale;
      if (sale) setDone({ id: sale.id, receiptNumber: sale.receiptNumber ?? "", totalCents: sale.totalCents, changeCents: (sale.payments ?? []).reduce((sum, p) => sum + (p.changeCents ?? 0), 0) });
      setLines([]); setReference(""); setCashTendered(""); setDiscount(""); setDiscountReason(""); setManagerPin(""); setApprovalNeeded(false); setCustomerId(""); setSplitTender("NONE"); setSplitAmount(""); setPayOpen(false); router.refresh();
    } catch (error) {
      const detail = error as Error & { status?: number; payload?: { code?: string } };
      if (detail.status === 403 && detail.payload?.code === "REQUIRE_APPROVAL") { setApprovalNeeded(true); toast.error("Manager approval is required for this discount"); }
      else toast.error(detail.message || "Could not complete sale");
    } finally { setBusy(false); }
  }

  const invoiceUrl = (id: string) => `/api/proxy/pos/v1/sales/${id}/invoice.pdf?storeId=${encodeURIComponent(storeId)}`;
  const tabs = ["Quick keys", ...categories];
  const browseList = React.useMemo(() => {
    const q = browseQuery.trim().toLowerCase();
    return products.filter((p) => (!browseCategory || p.category === browseCategory) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q) || p.barcode.includes(q)));
  }, [products, browseQuery, browseCategory]);
  const needsRegister = !sessionId;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-3">
        {canExit ? <Button variant="ghost" size="sm" asChild><Link href={`/s/${storeId}`}><ArrowLeft /> Exit</Link></Button> : null}
        <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Store: {storeName}</span><span className="text-sm font-medium">Point of sale</span><span className="text-sm text-muted-foreground">Cashier: {cashier}</span>
        <div className="ml-auto flex items-center gap-1"><IdleLock /><UserMenu /></div>
        <span className="hidden text-xs text-muted-foreground md:block"><kbd className="rounded border bg-muted px-1">/</kbd> scan or search · <kbd className="rounded border bg-muted px-1">F12</kbd> pay</span>
      </header>
      {loadProblems.length > 0 && <div role="alert" className="border-b bg-warning-soft px-4 py-2 text-sm text-warning">Some information could not be loaded: {loadProblems.join(" · ")}. You can keep selling; reload the page to try again.</div>}
      {needsRegister && !openTill && <div className="flex items-center gap-3 border-b bg-warning-soft px-4 py-2 text-sm text-warning"><span>The register is closed, so payment is switched off.</span><Button size="sm" onClick={() => setOpenTill(true)}>Open register</Button></div>}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Categories" className="flex shrink-0 gap-1 overflow-x-auto border-b bg-card p-2 md:w-40 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
          {tabs.map((tab) => <button key={tab} onClick={() => { setCategory(tab); setQuery(""); }} aria-pressed={category === tab && !query} className={cn("h-11 shrink-0 rounded-md px-3 text-left text-sm font-medium hover:bg-accent", category === tab && !query && "bg-primary text-primary-foreground hover:bg-primary")}>{tab}</button>)}
        </nav>
        <section aria-label="Products" className="flex min-h-0 flex-1 flex-col">
          <div className="flex gap-2 border-b bg-card p-2">
            <div className="relative flex-1"><ScanBarcode className={cn("pointer-events-none absolute left-3 top-3.5 size-4", scanFlash === "ok" ? "text-success" : scanFlash === "miss" ? "text-danger" : "text-muted-foreground")} /><Input ref={searchRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Scan a barcode or search products" placeholder="Scan barcode, or type a name / SKU and press Enter…" className={cn("h-11 pl-9! text-base", scanFlash === "ok" && "border-success", scanFlash === "miss" && "border-danger")} onKeyDown={searchKeyDown} /></div>
            <Button variant="outline" className="h-11" onClick={() => setBrowseOpen(true)}><List /> Browse items</Button>
          </div>
          <div className="grid flex-1 content-start gap-2 overflow-y-auto p-2 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">{visible.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">{products.length === 0 ? "This store has no products on sale yet. Add the products sent by the organisation under Products, or create one there." : "No products match."}</p>}{visible.map((product) => <button key={keyOf(product)} onClick={() => add(product)} disabled={product.stock <= 0} className="flex min-h-24 flex-col justify-between rounded-lg border bg-card p-3 text-left hover:border-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"><span className="line-clamp-2 text-sm font-medium">{product.name}</span><span className="flex items-end justify-between"><Money minor={product.priceMinor} /><span className={cn("text-xs", product.stock <= 5 ? "text-danger" : "text-muted-foreground")}>{product.stock <= 0 ? "Out" : `${product.stock} left`}</span></span></button>)}</div>
        </section>
        <aside aria-label="Cart" className="flex h-[45vh] shrink-0 flex-col border-t bg-card md:h-auto md:w-96 md:border-l md:border-t-0">
          <div className="flex items-center justify-between border-b px-4 py-3"><h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="size-4" /> Cart <span className="tabular text-sm text-muted-foreground">({itemCount})</span></h2><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => void loadHolds()}><List /> Holds</Button><Button variant="ghost" size="sm" disabled={!lines.length || busy} onClick={() => void hold()}><PauseCircle /> Hold</Button></div></div>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">{lines.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">Cart is empty. Scan a barcode or tap an item.</li>}{lines.map((line) => { const id = keyOf(line.product); return <li key={id} className="grid gap-1 px-3 py-2"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{line.product.name}</p><p className="tabular text-xs text-muted-foreground">{formatMoney(line.product.priceMinor)} · GST {line.product.taxRate}%{line.product.includesTax ? " incl." : ""}</p></div><div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label={`Decrease ${line.product.name}`} onClick={() => setQty(id, -1)}><Minus /></Button><span className="tabular w-7 text-center font-medium" aria-live="polite">{line.qty}</span><Button variant="outline" size="icon" aria-label={`Increase ${line.product.name}`} onClick={() => setQty(id, 1)}><Plus /></Button></div><Money minor={Math.max(0, line.product.priceMinor * line.qty - line.discountCents)} className="w-20 text-right" /><Button variant="ghost" size="icon" aria-label={`Remove ${line.product.name}`} onClick={() => remove(id)}><Trash2 /></Button></div><div className="grid grid-cols-2 gap-1"><Input aria-label={`Note for ${line.product.name}`} placeholder="Line note" value={line.note} onChange={(event) => setLineNote(id, event.target.value)} /><Input aria-label={`Discount for ${line.product.name}`} placeholder="Line discount ₹" inputMode="decimal" value={line.discountCents ? String(line.discountCents / 100) : ""} onChange={(event) => setLineDiscount(id, event.target.value)} /></div></li>; })}</ul>
          <div className="space-y-1 border-t p-4">
            <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal (excl. GST)</span><Money minor={totals.subtotalCents} className="font-normal" /></div>
            {totals.charges.map((charge) => <div key={charge.id} className="flex justify-between text-sm text-muted-foreground"><span>{charge.name}</span><Money minor={charge.amountCents} className="font-normal" /></div>)}
            <div className="flex justify-between text-sm text-muted-foreground"><span>GST</span><Money minor={totals.taxCents} className="font-normal" /></div>
            <div className="flex items-baseline justify-between pt-1"><span className="font-semibold">Total</span><Money minor={total} className="text-2xl font-semibold" /></div>
            {quoteError && <p role="alert" className="text-xs text-danger">{quoteError}</p>}
            <Button size="touch" className="mt-3 w-full" disabled={!lines.length || busy || !priced} onClick={() => setPayOpen(true)}>{quoting ? "Pricing…" : `Pay ${lines.length ? formatMoney(total) : ""}`}</Button>
          </div>
        </aside>
      </div>

      <Dialog open={openTill} onOpenChange={setOpenTill}><DialogContent><DialogTitle>Open register</DialogTitle><DialogDescription>A register is the cash drawer you sell from. Opening it starts your shift: count the cash in the drawer and enter it as the opening float.</DialogDescription>{usableRegisters.length === 0 ? <div role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">This store has no active register yet, so a till cannot be opened. {canAddRegister ? <Link href={`/org/stores/${storeId}`} className="font-medium underline">Add a register to this store</Link> : "Ask an organisation administrator to add one."}</div> : <label className="grid gap-1 text-sm">Register<select className="h-10 rounded-md border bg-background px-3" value={registerId} onChange={(event) => { setRegisterId(event.target.value); const open = usableRegisters.find((r) => r.id === event.target.value); if (open?.status === "OPEN") { setSessionId(open.sessionId); setOpenTill(false); } }}>{usableRegisters.map((register) => <option key={register.id} value={register.id}>{register.name}{register.status === "OPEN" ? " · already open: select to continue" : ""}</option>)}</select></label>}<label className="grid gap-1 text-sm">Opening float (₹)<Input inputMode="decimal" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} /></label><Button onClick={() => void openSession()} disabled={busy || !registerId || usableRegisters.length === 0 || usableRegisters.find((r) => r.id === registerId)?.status === "OPEN"}>Open register</Button></DialogContent></Dialog>

      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}><DialogContent className="max-w-2xl"><DialogTitle>Add items from the list</DialogTitle><DialogDescription>Search or filter, then tap Add. The window stays open so you can add several items.</DialogDescription>
        <div className="grid gap-2 sm:grid-cols-[1fr_12rem]"><Input autoFocus value={browseQuery} onChange={(event) => setBrowseQuery(event.target.value)} placeholder="Search name, SKU, brand or barcode" aria-label="Search items" /><NativeSelect value={browseCategory} onChange={(event) => setBrowseCategory(event.target.value)} aria-label="Filter by category"><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect></div>
        <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">{browseList.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No items match.</li>}{browseList.map((product) => { const inCart = lines.find((l) => keyOf(l.product) === keyOf(product))?.qty ?? 0; return <li key={keyOf(product)} className="flex items-center gap-3 px-3 py-2 text-sm"><div className="min-w-0 flex-1"><p className="truncate font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.sku}{product.category ? ` · ${product.category}` : ""} · {product.stock <= 0 ? "Out of stock" : `${product.stock} in stock`}</p></div>{inCart > 0 && <span className="text-xs text-muted-foreground">{inCart} in cart</span>}<Money minor={product.priceMinor} /><Button size="sm" disabled={product.stock <= 0} onClick={() => add(product)}><Plus /> Add</Button></li>; })}</ul>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">{itemCount} item{itemCount === 1 ? "" : "s"} in cart</span><DialogClose asChild><Button>Done</Button></DialogClose></div></DialogContent></Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}><DialogContent><DialogTitle>Take payment</DialogTitle><DialogDescription>The server prices and taxes the bill, and the invoice shows the same figures.</DialogDescription><p className="tabular text-3xl font-semibold">{formatMoney(total)}</p><div className="grid grid-cols-3 gap-2">{(["CASH", "UPI", "CARD"] as const).map((value) => <Button key={value} size="touch" variant={tender === value ? "default" : "outline"} onClick={() => setTender(value)}>{value}</Button>)}</div>{tender === "CASH" && <><Input placeholder="Cash tendered (₹)" inputMode="decimal" value={cashTendered} onChange={(event) => setCashTendered(event.target.value)} />{cashTendered && Number(cashTendered) * 100 >= total && splitTender === "NONE" && <p className="text-sm">Change to return: <b>{formatMoney(Math.round(Number(cashTendered) * 100) - total)}</b></p>}</>}{tender !== "CASH" && <Input placeholder="Reference (optional for UPI/card)" value={reference} onChange={(event) => setReference(event.target.value)} />}<NativeSelect value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">No customer attached</option>{customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</option>)}</NativeSelect><Button variant="outline" onClick={() => setCustomerCreateOpen(true)}>Quick-create customer</Button><div className="grid grid-cols-2 gap-2"><Input placeholder="Discount (₹)" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} /><Input placeholder="Discount reason" value={discountReason} onChange={(event) => setDiscountReason(event.target.value)} /></div><div className="grid grid-cols-2 gap-2"><NativeSelect value={splitTender} onChange={(event) => setSplitTender(event.target.value as "NONE" | "CARD" | "UPI")}><option value="NONE">Single tender</option><option value="CARD">Split with card</option><option value="UPI">Split with UPI</option></NativeSelect>{splitTender !== "NONE" && <Input placeholder="First tender amount ₹" inputMode="decimal" value={splitAmount} onChange={(event) => setSplitAmount(event.target.value)} />}</div>{approvalNeeded && <div className="rounded-md border border-warning bg-warning-soft p-3"><p className="mb-2 text-sm font-medium">Manager approval required</p><Input aria-label="Manager PIN" placeholder="Manager PIN" inputMode="numeric" type="password" value={managerPin} onChange={(event) => setManagerPin(event.target.value)} /></div>}<div className="flex justify-end gap-2"><DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose><Button onClick={() => void complete()} disabled={busy || !priced}>Complete sale</Button></div></DialogContent></Dialog>

      <Dialog open={Boolean(done)} onOpenChange={(open) => { if (!open) { setDone(null); setTimeout(() => searchRef.current?.focus(), 100); } }}><DialogContent><DialogTitle>Sale complete</DialogTitle><DialogDescription>{done?.receiptNumber ? `Invoice ${done.receiptNumber}` : "The sale was recorded."}</DialogDescription><p className="tabular text-3xl font-semibold">{formatMoney(done?.totalCents ?? 0)}</p>{(done?.changeCents ?? 0) > 0 && <p className="text-sm">Change to return: <b>{formatMoney(done?.changeCents ?? 0)}</b></p>}<div className="grid gap-2 sm:grid-cols-2"><Button asChild size="touch"><a href={done ? invoiceUrl(done.id) : "#"} target="_blank" rel="noreferrer" download={done ? `${done.receiptNumber || "invoice"}.pdf` : undefined}><Download /> Download invoice (PDF)</a></Button><DialogClose asChild><Button size="touch" variant="outline">New sale</Button></DialogClose></div></DialogContent></Dialog>

      <Dialog open={customerCreateOpen} onOpenChange={setCustomerCreateOpen}><DialogContent><DialogTitle>Quick-create customer</DialogTitle><DialogDescription>Create a customer without leaving the till.</DialogDescription><Input placeholder="Name" value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} /><Input placeholder="Phone" value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} /><Button onClick={async () => { try { const created = await clientApi<Customer>("/pos/v1/customers", { method: "POST", body: JSON.stringify({ storeId, name: newCustomerName, phone: newCustomerPhone }) }); setCustomerOptions((current) => [...current, created]); setCustomerId(created.id); setNewCustomerName(""); setNewCustomerPhone(""); setCustomerCreateOpen(false); toast.success("Customer created"); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create customer"); } }}>Create customer</Button></DialogContent></Dialog>
      <Dialog open={holdsOpen} onOpenChange={setHoldsOpen}><DialogContent><DialogTitle>Held sales</DialogTitle><DialogDescription>Resume a cart held at this store.</DialogDescription><div className="grid gap-2">{holds.length === 0 && <p className="text-sm text-muted-foreground">No held sales.</p>}{holds.map((held) => <Button key={held.id} variant="outline" className="justify-between" onClick={() => void resume(held.id)}><span>{new Date(held.createdAt).toLocaleString()}</span><span>{held.payload?.lines?.length ?? 0} lines</span></Button>)}</div></DialogContent></Dialog>
    </div>
  );
}

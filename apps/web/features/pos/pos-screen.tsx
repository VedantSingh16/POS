"use client";
import { LocalizedText, useTranslate } from "@/components/i18n/localized-text";

/* Held-sale payloads are persisted JSON and are narrowed when they are resumed. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Download, Info, List, Minus, PauseCircle, Plus, ScanBarcode, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { Money } from "@/components/data/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { currencyCode, formatDateTime, formatMoney as formatMoneyValue, formatNumber, toInput, toMinor } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/features/types";
import { IdleLock, UserMenu } from "@/components/app/user-menu";
import { useMe } from "@/components/app/session-context";
import { clientApi } from "@/features/client-api";
import { useRouter } from "next/navigation";
import { ConfigurableFieldValues, type ConfiguredField } from "@/features/settings/configurable-field-values";
import { BrandMark } from "@/components/brand/brand-mark";
import { useLocale } from "@/components/i18n/locale-provider";
import { safeRandomUUID } from "@/lib/uuid";

type PosProduct = Product & { variantId?: string; barcodes?: string[]; brand?: string; includesTax?: boolean; customFields?: Record<string, string | number | boolean> };
/** `enteredPriceCents` is only used for open-price items, where the cashier types the price. */
type Line = { product: PosProduct; qty: number; note: string; discountPercent: string; enteredPriceCents?: number };
type Customer = { id: string; name: string; phone?: string };
type QuoteLine = { variantId: string; unitPriceCents: number; listPriceCents?: number; priceSource?: string; priceRuleName?: string | null };
type AppliedPromotion = { code: string; discountCents: number };
type RejectedPromotion = { code: string; reason: string };
const TENDER_LABELS: Record<string, string> = { CASH: "Cash", CARD: "Card", UPI: "UPI / QR", WALLET: "Wallet", POINTS: "Loyalty points", OTHER: "Other" };
type Quote = {
  subtotalCents: number; discountCents: number; chargeCents: number; charges: { id: string; name: string; amountCents: number; taxCents: number }[]; taxCents: number; totalCents: number;
  lines?: QuoteLine[]; promotions?: AppliedPromotion[]; rejectedPromotions?: RejectedPromotion[]; promotionDiscountCents?: number; quoteHash?: string; requiresManagerApproval?: boolean; enabledTenders?: string[];
};
type Attempt = { id: string; status: "PENDING" | "CAPTURED" | "FAILED" | "VOIDED" | "UNKNOWN"; amountCents: number; tenderType: "CARD" | "UPI"; failureReason?: string };

const REJECTION_TEXT: Record<string, string> = {
  NOT_FOUND: "This code does not exist", INACTIVE: "This offer is switched off", NOT_STARTED: "This offer has not started yet", EXPIRED: "This offer has expired",
  LIMIT_REACHED: "This offer has been used up", CUSTOMER_LIMIT: "This customer has already used this offer", MIN_SUBTOTAL: "The bill is below the minimum for this offer",
  NOT_APPLICABLE: "No item in the cart qualifies", SUPERSEDED: "A better offer was applied instead",
};
type Done = { id: string; receiptNumber: string; totalCents: number; changeCents: number };
type PendingSale = { clientSaleId: string; createdAt: string; payload: Record<string, unknown>; error?: string };
const pendingSaleKey = (storeId: string) => `pos.pending-sales.${storeId}`;
function readPendingSales(storeId: string): PendingSale[] {
  try {
    const value = JSON.parse(localStorage.getItem(pendingSaleKey(storeId)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is PendingSale => Boolean(entry && typeof entry === "object" && typeof (entry as PendingSale).clientSaleId === "string")) : [];
  } catch { return []; }
}

type Props = {
  storeId: string;
  storeName: string;
  cashier: string;
  products: PosProduct[];
  categories: string[];
  canExit: boolean;
  registers: { id: string; name: string; sessionId: string; status: string; active?: boolean }[];
  customers: Customer[];
  currentUserId: string;
  checkoutConfig: {
    countryCode?: string; taxRegime?: "GST" | "VAT" | "TAX";
    fields: ConfiguredField[]; coreFields: string[]; handlers: { id: string; name: string }[]; requireBillHandler: boolean;
    requireDiscountReasonCode: boolean; discountReasons: { code: string; name: string }[];
    discounts: { lineEnabled: boolean; lineMaxPercent: number; billEnabled: boolean; billMaxPercent: number; allowStacking: boolean };
    productFields: ConfiguredField[]; productCoreFields: string[];
  };
  /** Messages for parts of the screen that could not be loaded (the rest of the screen still works). */
  loadProblems?: string[];
};

const keyOf = (product: PosProduct) => product.variantId ?? product.id;

/** Local estimate shown only until the server's price arrives. The server figure is what is charged. */
function validPercent(value: string, max = 100) {
  return value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= max);
}

function estimate(lines: Line[], orderDiscountPercent = 0): Quote {
  let subtotal = 0; let tax = 0; let lineDiscount = 0;
  for (const line of lines) {
    const gross = Math.max(0, (line.enteredPriceCents ?? line.product.priceMinor) * line.qty);
    const lineCut = Math.round(gross * Math.min(100, Math.max(0, Number(line.discountPercent) || 0)) / 100);
    const discountedGross = gross - lineCut;
    const rate = line.product.taxRate;
    const lineTax = line.product.includesTax ? Math.round((discountedGross * rate) / (100 + rate)) : Math.round((discountedGross * rate) / 100);
    subtotal += line.product.includesTax ? discountedGross - lineTax : discountedGross; tax += lineTax; lineDiscount += lineCut;
  }
  const orderDiscount = Math.round(subtotal * orderDiscountPercent / 100);
  const adjustedTax = Math.max(0, tax - Math.round((orderDiscount * tax) / Math.max(1, subtotal)));
  return { subtotalCents: subtotal, discountCents: lineDiscount + orderDiscount, chargeCents: 0, charges: [], taxCents: adjustedTax, totalCents: subtotal - orderDiscount + adjustedTax };
}

export function PosScreen({ storeId, storeName, cashier, products: productsIn, categories, canExit, registers, customers, currentUserId, checkoutConfig, loadProblems = [] }: Props) {
  const { locale } = useLocale();
  const formatMoney = (minor: number) => formatMoneyValue(minor, locale);
  const router = useRouter();
  const t = useTranslate();
  const taxLabel = checkoutConfig.taxRegime === "GST" ? "GST" : checkoutConfig.taxRegime === "VAT" ? "VAT" : "Tax";
  const subtotalLabel = taxLabel === "GST" ? "Subtotal (excl. GST)" : taxLabel === "VAT" ? "Subtotal (excl. VAT)" : "Subtotal (excl. Tax)";
  const searchableByBrand = checkoutConfig.productCoreFields.includes("brand");
  const [products, setProducts] = React.useState<PosProduct[]>(productsIn);
  // Reconcile inventory after server navigation refreshes the product snapshot.
  // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const [tenderChoice, setTender] = React.useState("CASH");
  const [cashTendered, setCashTendered] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [customerId, setCustomerId] = React.useState("");
  const [handledById, setHandledById] = React.useState(currentUserId);
  const [customFieldValues, setCustomFieldValues] = React.useState<Record<string, string | number | boolean>>({});
  const [customerOptions, setCustomerOptions] = React.useState(customers);
  const [customerCreateOpen, setCustomerCreateOpen] = React.useState(false);
  const [newCustomerName, setNewCustomerName] = React.useState("");
  const [newCustomerPhone, setNewCustomerPhone] = React.useState("");
  const [couponInput, setCouponInput] = React.useState("");
  const [couponCode, setCouponCode] = React.useState("");
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [discount, setDiscount] = React.useState("");
  const [discountReasonCode, setDiscountReasonCode] = React.useState("");
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
  // The store may switch some tenders off; fall back to the first one it offers.
  const offeredTenders = quote?.enabledTenders;
  const tenderOptions = offeredTenders ?? ["CASH", "CARD", "UPI"];
  const tender = tenderOptions.includes(tenderChoice) ? tenderChoice : tenderOptions[0] ?? tenderChoice;
  const [quoting, setQuoting] = React.useState(false);
  const [done, setDone] = React.useState<Done | null>(null);
  const [pendingSales, setPendingSales] = React.useState<PendingSale[]>([]);
  const [scanFlash, setScanFlash] = React.useState<"" | "ok" | "miss">("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const quoteSeq = React.useRef(0);
  /** One id per bill: if the request is sent twice the server returns the same sale. */
  const saleKey = React.useRef(safeRandomUUID());

  const orderDiscountPercent = checkoutConfig.discounts.billEnabled && discount.trim() !== "" ? Number(discount) : 0;
  const percentagesValid = (!checkoutConfig.discounts.billEnabled || validPercent(discount, checkoutConfig.discounts.billMaxPercent))
    && lines.every((line) => !checkoutConfig.discounts.lineEnabled || validPercent(line.discountPercent, checkoutConfig.discounts.lineMaxPercent));

  /* ── Server price for the cart: the same calculation the sale and the invoice use ── */
  // This effect owns the asynchronous quote lifecycle and clears stale quotes for an empty cart.
  React.useEffect(() => {
    if (!lines.length) {
      // Clear the now-invalid server quote when the cart becomes empty.
      /* eslint-disable react-hooks/set-state-in-effect */
      setQuote(null); setQuoteError(""); setQuoting(false); return;
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    if (!percentagesValid) {
      setQuoteError("Discount percentage exceeds this store’s configured limit.");
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const result = await clientApi<Quote>("/pos/v1/sales/quote", { method: "POST", body: JSON.stringify({ storeId, customerId: customerId || undefined, couponCode: checkoutConfig.discounts.billEnabled ? couponCode || undefined : undefined, discountPercent: checkoutConfig.discounts.billEnabled ? orderDiscountPercent : undefined, lines: lines.map((line) => ({ variantId: keyOf(line.product), quantity: line.qty, discountPercent: checkoutConfig.discounts.lineEnabled ? Number(line.discountPercent) || undefined : undefined, unitPriceCents: line.enteredPriceCents })) }) });
        if (seq === quoteSeq.current) { setQuote(result); setQuoteError(""); }
      } catch (error) {
        if (seq === quoteSeq.current) { setQuote(null); setQuoteError(error instanceof Error ? error.message : "Could not price this bill"); }
      } finally { if (seq === quoteSeq.current) setQuoting(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [lines, orderDiscountPercent, percentagesValid, storeId, customerId, couponCode, checkoutConfig.discounts]);

  // A card/UPI payment taken for one total is not valid for another, so it is ignored once the bill changes.
  const liveAttempt = attempt && quote && attempt.amountCents === quote.totalCents ? attempt : null;

  const estimateLines = checkoutConfig.discounts.lineEnabled ? lines : lines.map((line) => ({ ...line, discountPercent: "" }));
  const totals = quote && percentagesValid ? quote : estimate(estimateLines, Number.isFinite(orderDiscountPercent) && orderDiscountPercent >= 0 && orderDiscountPercent <= checkoutConfig.discounts.billMaxPercent ? orderDiscountPercent : 0);
  const hasManualDiscount = orderDiscountPercent > 0 || (checkoutConfig.discounts.lineEnabled && lines.some((line) => Number(line.discountPercent) > 0));
  const showDiscountReason = checkoutConfig.requireDiscountReasonCode || (checkoutConfig.coreFields.includes("discountReason") && hasManualDiscount);
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const total = totals.totalCents;
  const priced = Boolean(quote) && !quoting && percentagesValid;

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => q ? p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (searchableByBrand && p.brand?.toLowerCase().includes(q)) || p.barcode.includes(q) || p.barcodes?.some((barcode) => barcode.toLowerCase().includes(q)) : category === "Quick keys" ? p.hot : p.category === category);
  }, [products, query, category, searchableByBrand]);

  const add = React.useCallback((product: PosProduct) => {
    // The store's negative-stock policy decides: BLOCK stops the sale, WARN/ALLOW let the cashier sell and the stock goes below zero.
    if (product.stock <= 0 && !product.sellWithoutStock) { toast.warning(`${product.name} has no stock. Receive stock under Inventory first, or ask an administrator to allow selling below zero in Settings.`); return false; }
    if (product.stock <= 0) toast.warning(`${product.name} has no stock on record. Check the shelf and update stock later.`);
    setLines((current) => {
      const index = current.findIndex((line) => keyOf(line.product) === keyOf(product));
      if (index === -1) return [...current, { product, qty: 1, note: "", discountPercent: "" }];
      return current.map((line, i) => i === index ? { ...line, qty: product.sellWithoutStock ? line.qty + 1 : Math.min(line.qty + 1, product.stock) } : line);
    });
    return true;
  }, []);
  const setQty = (id: string, delta: number) => setLines((current) => current.flatMap((line) => keyOf(line.product) !== id ? [line] : line.qty + delta <= 0 ? [] : [{ ...line, qty: line.product.sellWithoutStock ? line.qty + delta : Math.min(line.qty + delta, line.product.stock) }]));
  const setLinePrice = (id: string, value: string) => setLines((current) => current.map((line) => keyOf(line.product) === id ? { ...line, enteredPriceCents: value === "" ? undefined : Math.max(0, toMinor(value)) } : line));
  const remove = (id: string) => setLines((current) => current.filter((line) => keyOf(line.product) !== id));
  const setLineNote = (id: string, note: string) => setLines((current) => current.map((line) => keyOf(line.product) === id ? { ...line, note } : line));
  const setLineDiscount = (id: string, value: string) => setLines((current) => current.map((line) => keyOf(line.product) === id ? { ...line, discountPercent: value } : line));

  /* ── Way 1: barcode scan. A scanner types the code and presses Enter. ── */
  async function scan(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const code_ = code.toLowerCase();
    let found = products.find((p) => p.barcode === code || p.barcodes?.includes(code) || p.sku.toLowerCase() === code_);
    if (!found) {
      // The screen only holds the first products of a large catalogue: ask the server for this exact code.
      try {
        const result = await clientApi<{ products: any[]; inventoryPolicy?: string }>(`/pos/v1/catalog/search?storeId=${encodeURIComponent(storeId)}&q=${encodeURIComponent(code)}`);
        const hit = (result.products ?? []).find((p) => p.barcode === code || (p.barcodes ?? []).includes(code) || String(p.sku).toLowerCase() === code_) ?? ((result.products ?? []).length === 1 ? result.products[0] : undefined);
        if (hit) {
          found = { id: hit.variantId, variantId: hit.variantId, sku: hit.sku ?? "", barcode: hit.barcode ?? "", barcodes: hit.barcodes ?? [], name: hit.variantName && hit.variantName !== hit.productName ? `${hit.productName} · ${hit.variantName}` : hit.productName, category: hit.categoryName || "Uncategorised", brand: hit.brand ?? "", customFields: hit.customFields ?? {}, priceMinor: hit.priceCents ?? 0, includesTax: hit.includesTax === true, taxRate: (hit.taxBps ?? 0) / 100, stock: hit.stock ?? 0, sellWithoutStock: (result.inventoryPolicy ?? "BLOCK") !== "BLOCK", openPrice: hit.openPrice === true, floorPriceCents: hit.floorPriceCents ?? 0, status: "ACTIVE", hot: true };
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
      await clientApi("/pos/v1/holds", { method: "POST", body: JSON.stringify({ storeId, registerId, payload: { lines: lines.map((line) => ({ variantId: keyOf(line.product), quantity: line.qty, note: line.note, discountPercent: Number(line.discountPercent) || 0 })) } }) });
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
      const session = await clientApi<{ id: string }>("/pos/v1/sessions", { method: "POST", body: JSON.stringify({ storeId, registerId, openingFloatCents: toMinor(openingFloat || 0) }) });
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
      const result = await clientApi<{ payload?: { lines?: { variantId: string; quantity: number; note?: string; discountPercent?: number; discountCents?: number }[] } }>(`/pos/v1/holds/${holdId}/resume`, { method: "POST", headers: { "x-store-id": storeId } });
      const resumed = result.payload?.lines ?? [];
      setLines(resumed.flatMap((item) => { const product = products.find((candidate) => keyOf(candidate) === item.variantId || candidate.id === item.variantId); if (!product) return []; const legacyPercent = item.discountCents && product.priceMinor > 0 ? (item.discountCents / (product.priceMinor * item.quantity)) * 100 : 0; return [{ product, qty: item.quantity, note: item.note ?? "", discountPercent: item.discountPercent === undefined ? (legacyPercent ? legacyPercent.toFixed(2) : "") : String(item.discountPercent) }]; }));
      setHoldsOpen(false); toast.success("Held sale resumed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not resume held sale"); }
  }

  const pendingSyncLock = React.useRef(false);
  const retryPendingSales = React.useCallback(async () => {
    if (!navigator.onLine || pendingSyncLock.current) return;
    const queued = readPendingSales(storeId);
    if (!queued.length) { setPendingSales([]); return; }
    pendingSyncLock.current = true;
    setBusy(true);
    try {
      for (const pending of queued) {
        try {
          const result = await clientApi<{ sale?: { receiptNumber?: string } }>("/pos/v1/sales", { method: "POST", body: JSON.stringify(pending.payload) });
          const remaining = readPendingSales(storeId).filter((entry) => entry.clientSaleId !== pending.clientSaleId);
          localStorage.setItem(pendingSaleKey(storeId), JSON.stringify(remaining));
          setPendingSales(remaining);
          toast.success(`Pending sale synced${result.sale?.receiptNumber ? ` · ${result.sale.receiptNumber}` : ""}.`);
          router.refresh();
        } catch (error) {
          const detail = error as Error & { payload?: { code?: string }; status?: number };
          const message = detail.payload?.code === "PRICE_CHANGED" ? "Price changed while offline. Review and ring up this bill again." : detail.payload?.code === "REQUIRE_APPROVAL" ? "Manager approval is required. Review and ring up this bill again." : detail.message || "Sync failed; the sale remains pending.";
          const latest = readPendingSales(storeId).map((entry) => entry.clientSaleId === pending.clientSaleId ? { ...entry, error: message } : entry);
          localStorage.setItem(pendingSaleKey(storeId), JSON.stringify(latest));
          setPendingSales(latest);
          if (detail.status !== undefined && detail.status < 500) toast.error(message);
        }
      }
    } finally { pendingSyncLock.current = false; setBusy(false); }
  }, [router, storeId]);

  const retryPendingRef = React.useRef(retryPendingSales);
  React.useEffect(() => { retryPendingRef.current = retryPendingSales; }, [retryPendingSales]);
  React.useEffect(() => {
    // Hydrate browser-local pending work after hydration to avoid a server/client markup mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingSales(readPendingSales(storeId));
    const onOnline = () => { void retryPendingRef.current(); };
    window.addEventListener("online", onOnline);
    const retryTimer = navigator.onLine ? window.setTimeout(() => { void retryPendingRef.current(); }, 0) : undefined;
    return () => { window.removeEventListener("online", onOnline); if (retryTimer !== undefined) window.clearTimeout(retryTimer); };
  }, [storeId]);

  async function complete() {
    if (!sessionId || !registerId) { toast.error("Open a register before taking payment"); return; }
    if (!percentagesValid) { toast.error("Discount percentage exceeds this store’s configured limit."); return; }
    if (!quote) { toast.error(quoteError || "The bill is still being priced. Try again in a moment."); return; }
    if (checkoutConfig.requireBillHandler && !handledById) { toast.error("Select who handled this bill."); return; }
    const missingField = checkoutConfig.fields.find((field) => field.active && field.required && (customFieldValues[field.key] === undefined || customFieldValues[field.key] === ""));
    if (missingField) { toast.error(`${missingField.label} is required.`); return; }
    const checkoutTotal = quote.totalCents;
    let salePayload: Record<string, unknown> | null = null;
    let saleRequestStarted = false;
    let canQueueOffline = false;
    setBusy(true);
    try {
      const splitCents = splitTender === "NONE" ? 0 : toMinor(splitAmount || 0);
      if (splitTender !== "NONE" && (splitCents <= 0 || splitCents >= checkoutTotal)) { toast.error("Enter a split amount smaller than the total"); return; }
      const tenderedCents = tender === "CASH" && cashTendered ? toMinor(cashTendered) : undefined;
      if (splitTender === "NONE" && tenderedCents !== undefined && tenderedCents < checkoutTotal) { toast.error(`Cash tendered is less than the total (${formatMoney(checkoutTotal)})`); return; }
      const usableAttempt = attempt && attempt.status === "CAPTURED" && splitTender === "NONE" && attempt.tenderType === tender && attempt.amountCents === checkoutTotal ? attempt : null;
      const payments = usableAttempt
        ? [{ tenderType: tender, attemptId: usableAttempt.id }]
        : splitTender === "NONE"
        ? [{ tenderType: tender, amountCents: checkoutTotal, ...(tenderedCents !== undefined ? { tenderedCents } : {}), reference }]
        : [{ tenderType: tender, amountCents: splitCents, reference }, { tenderType: splitTender, amountCents: checkoutTotal - splitCents, reference }];
      const selectedReason = checkoutConfig.discountReasons.find((reason) => reason.code === discountReasonCode);
      salePayload = { storeId, registerId, sessionId, customerId: customerId || undefined, handledById: handledById || currentUserId, customFields: customFieldValues, couponCode: checkoutConfig.discounts.billEnabled ? couponCode || undefined : undefined, quoteHash: quote.quoteHash, discountPercent: checkoutConfig.discounts.billEnabled ? orderDiscountPercent : undefined, discountReasonCode: discountReasonCode || undefined, discountReason: selectedReason?.name, managerPin: managerPin || undefined, clientSaleId: saleKey.current, lines: lines.map((line) => ({ variantId: keyOf(line.product), quantity: line.qty, unitPriceCents: line.enteredPriceCents, note: line.note || undefined, discountPercent: checkoutConfig.discounts.lineEnabled ? Number(line.discountPercent) || undefined : undefined, discountReason: checkoutConfig.discounts.lineEnabled && Number(line.discountPercent) > 0 ? selectedReason?.name : undefined })), payments };
      // The browser queue is limited to simple cash bills so it never persists credentials,
      // customer data, custom-field values, approval data, or non-cash payment attempts.
      canQueueOffline = tender === "CASH" && splitTender === "NONE" && !usableAttempt && !attempt && !managerPin && !approvalNeeded
        && !customerId && Object.keys(customFieldValues).length === 0 && !couponCode && !reference
        && orderDiscountPercent === 0 && lines.every((line) => !line.product.openPrice && line.enteredPriceCents === undefined && (Number(line.discountPercent) || 0) === 0 && !line.note);
      saleRequestStarted = true;
      const result = await clientApi<{ sale?: { id: string; receiptNumber?: string; totalCents: number; payments?: { changeCents?: number }[] } }>("/pos/v1/sales", { method: "POST", body: JSON.stringify(salePayload) });
      // Deduct sold quantities from the on-screen stock immediately, then refresh from the server.
      const soldByVariant = new Map<string, number>();
      for (const line of lines) soldByVariant.set(keyOf(line.product), (soldByVariant.get(keyOf(line.product)) ?? 0) + line.qty);
      setProducts((current) => current.map((p) => { const sold = soldByVariant.get(keyOf(p)) ?? 0; return sold ? { ...p, stock: Math.max(0, (p.stock ?? 0) - sold) } : p; }));
      const sale = result.sale;
      if (sale) setDone({ id: sale.id, receiptNumber: sale.receiptNumber ?? "", totalCents: sale.totalCents, changeCents: (sale.payments ?? []).reduce((sum, p) => sum + (p.changeCents ?? 0), 0) });
      setLines([]); setReference(""); setCashTendered(""); setDiscount(""); setDiscountReasonCode(""); setManagerPin(""); setApprovalNeeded(false); setCustomerId(""); setHandledById(currentUserId); setCustomFieldValues({}); setSplitTender("NONE"); setSplitAmount(""); setCouponInput(""); setCouponCode(""); setAttempt(null); saleKey.current = safeRandomUUID(); setPayOpen(false); router.refresh();
    } catch (error) {
      const detail = error as Error & { status?: number; payload?: { code?: string } };
      if (detail.status === 403 && detail.payload?.code === "REQUIRE_APPROVAL") { setApprovalNeeded(true); toast.error(detail.message || "Manager approval is required"); }
      else if (detail.status === 409 && detail.payload?.code === "PRICE_CHANGED") {
        const fresh = (detail.payload as { quote?: Quote }).quote;
        if (fresh) setQuote(fresh);
        toast.warning("The price changed while this bill was open. Check the new total, then complete the sale again.");
      }
      else if (saleRequestStarted && canQueueOffline && salePayload && detail.status === undefined) {
        try {
          const queued = readPendingSales(storeId);
          if (!queued.some((entry) => entry.clientSaleId === saleKey.current)) {
            queued.push({ clientSaleId: saleKey.current, createdAt: new Date().toISOString(), payload: salePayload });
            localStorage.setItem(pendingSaleKey(storeId), JSON.stringify(queued));
          }
          setPendingSales(readPendingSales(storeId));
          setLines([]); setReference(""); setCashTendered(""); setDiscount(""); setDiscountReasonCode(""); setManagerPin(""); setApprovalNeeded(false); setCustomerId(""); setHandledById(currentUserId); setCustomFieldValues({}); setSplitTender("NONE"); setSplitAmount(""); setCouponInput(""); setCouponCode(""); setAttempt(null); saleKey.current = safeRandomUUID(); setPayOpen(false);
          toast.warning("Connection lost. This cash sale is pending sync and is not confirmed yet. Keep this device signed in and retry when online.");
        } catch {
          toast.error("Connection lost and this device could not save the pending sale. Keep the bill open and try again when online.");
        }
      }
      else toast.error(detail.message || "Could not complete sale");
    } finally { setBusy(false); }
  }

  async function chargeOnline() {
    if (!quote || (tender !== "CARD" && tender !== "UPI")) return;
    setBusy(true);
    try {
      const result = await clientApi<Attempt>("/pos/v1/payments/attempts", { method: "POST", body: JSON.stringify({ storeId, tenderType: tender, amountCents: quote.totalCents, idempotencyKey: `${saleKey.current}:${tender}:${quote.totalCents}`, clientSaleId: saleKey.current }) });
      setAttempt(result);
      if (result.status === "CAPTURED") toast.success("Payment received");
      else if (result.status === "FAILED") toast.error(result.failureReason || "The payment was declined");
      else toast.warning("No confirmed result yet. Check the status before taking the payment again.");
    } catch (error) {
      const detail = error as Error & { payload?: { code?: string; attemptId?: string } };
      toast.error(detail.payload?.code === "PAYMENT_UNRESOLVED" ? "An earlier payment on this bill has no confirmed result. Check its status first." : detail.message || "Could not start the payment");
    } finally { setBusy(false); }
  }

  async function checkAttempt() {
    if (!attempt) return;
    try { setAttempt(await clientApi<Attempt>(`/pos/v1/payments/attempts/${attempt.id}`)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not check the payment"); }
  }

  const invoiceUrl = (id: string) => `/api/proxy/pos/v1/sales/${id}/invoice.pdf?storeId=${encodeURIComponent(storeId)}`;
  const tabs = ["Quick keys", ...(checkoutConfig.productCoreFields.includes("category") ? categories : [])];
  const browseList = React.useMemo(() => {
    const q = browseQuery.trim().toLowerCase();
    return products.filter((p) => (!browseCategory || p.category === browseCategory) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (searchableByBrand && (p.brand ?? "").toLowerCase().includes(q)) || p.barcode.includes(q)));
  }, [products, browseQuery, browseCategory, searchableByBrand]);
  const needsRegister = !sessionId;

  return (
    <div className="app-ui flex h-dvh min-h-[480px] flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-3 sm:px-4">
        {canExit ? <Button variant="ghost" size="sm" aria-label="Exit point of sale" asChild><Link href={`/s/${storeId}`}><ArrowLeft className="rtl:rotate-180" /><span className="hidden sm:inline"><LocalizedText value={"Exit"} /></span></Link></Button> : null}
        <BrandMark size="compact" className="rounded-[8px]" /><span className="hidden items-center gap-1.5 sm:inline-flex"><span className="font-sans text-sm font-bold tracking-tight"><LocalizedText value={"DeltPOS"} /></span><span className="rounded-[4px] bg-primary/10 px-1 py-0.5 text-[8px] font-bold leading-none tracking-[0.1em] text-primary"><LocalizedText value={"POS"} /></span></span><span className="h-5 border-s" /><span className="max-w-36 truncate text-sm font-medium">{storeName}</span>
        <span className="hidden text-sm text-muted-foreground md:block"><LocalizedText value={"Point of sale"} /></span>
        <div className="ms-auto flex items-center gap-2"><span className="hidden text-sm text-muted-foreground sm:inline">{cashier}</span><IdleLock /><UserMenu /></div>
        <span className="hidden text-xs text-muted-foreground xl:block"><kbd className="rounded border bg-muted px-1">/</kbd> <LocalizedText value={"scan · "} /><kbd className="rounded border bg-muted px-1"><LocalizedText value={"F12"} /></kbd> <LocalizedText value={"pay"} /></span>
      </header>
      {loadProblems.length > 0 && <div role="alert" className="border-b bg-warning-soft px-4 py-2 text-sm text-warning"><LocalizedText value={"Some information could not be loaded: "} />{loadProblems.join(" · ")}<LocalizedText value={". You can keep selling; reload the page to try again."} /></div>}
      {pendingSales.length > 0 && <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 border-b bg-warning-soft px-4 py-2 text-sm text-warning"><span>{pendingSales.length} <LocalizedText value={"cash "} /><LocalizedText value={pendingSales.length === 1 ? "sale is" : "sales are"} /> <LocalizedText value={"pending sync and are not confirmed yet. Keep this device signed in until sync completes."} />{pendingSales.some((sale) => sale.error) ? ` Latest issue: ${pendingSales.find((sale) => sale.error)?.error}` : ""}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void retryPendingSales()}><LocalizedText value={"Retry pending sales"} /></Button></div>}
      {needsRegister && !openTill && <div className="flex items-center gap-3 border-b bg-warning-soft px-4 py-2 text-sm text-warning"><span><LocalizedText value={"The register is closed, so payment is switched off."} /></span><Button size="sm" onClick={() => setOpenTill(true)}><LocalizedText value={"Open register"} /></Button></div>}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section aria-label={`${t("Products")} · ${taxLabel}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex gap-2 border-b bg-card p-2 sm:p-3">
            <div className="relative flex-1"><ScanBarcode className={cn("pointer-events-none absolute start-3 top-3.5 size-4", scanFlash === "ok" ? "text-success" : scanFlash === "miss" ? "text-danger" : "text-muted-foreground")} /><Input ref={searchRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Scan a barcode or search products" placeholder="Scan barcode, or type a name / SKU and press Enter…" className={cn("h-11 ps-9! text-base", scanFlash === "ok" && "border-success", scanFlash === "miss" && "border-danger")} onKeyDown={searchKeyDown} /></div>
            <Button variant="outline" className="h-11" onClick={() => setBrowseOpen(true)}><List /> <span className="hidden sm:inline"><LocalizedText value={"Browse items"} /></span><span className="sm:hidden"><LocalizedText value={"Browse"} /></span></Button>
          </div>
          <nav aria-label={t("Categories")} className="flex shrink-0 gap-1 overflow-x-auto border-b bg-card px-2 py-2 sm:px-3">
            {tabs.map((tab) => <button key={tab} onClick={() => { setCategory(tab); setQuery(""); }} aria-pressed={category === tab && !query} className={cn("h-9 shrink-0 rounded-sm border border-transparent px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground", category === tab && !query && "border-accent bg-accent font-semibold text-accent-foreground")}><LocalizedText value={tab} /></button>)}
          </nav>
          <div className="grid flex-1 content-start gap-2 overflow-y-auto p-2 sm:gap-3 sm:p-3 [grid-template-columns:repeat(auto-fill,minmax(10rem,1fr))]">{visible.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground"><LocalizedText value={products.length === 0 ? "This store has no products on sale yet. Add the products sent by the organisation under Products, or create one there." : "No products match."} /></p>}{visible.map((product) => <button key={keyOf(product)} onClick={() => add(product)} className={cn("flex min-h-24 flex-col justify-between rounded-md border bg-card p-3 text-start hover:border-primary hover:bg-accent/50", product.stock <= 0 && !product.sellWithoutStock && "opacity-50")}><span className="grid gap-1"><span className="line-clamp-2 text-sm font-medium">{product.name}</span>{checkoutConfig.productFields.filter((field) => field.active && product.customFields?.[field.key] !== undefined).map((field) => <span key={field.key} className="truncate text-[11px] text-muted-foreground">{field.label}: {typeof product.customFields?.[field.key] === "boolean" ? (product.customFields?.[field.key] ? "Yes" : "No") : String(product.customFields?.[field.key])}</span>)}</span><span className="flex items-end justify-between gap-2"><Money minor={product.priceMinor} /><span className={cn("text-xs", product.stock <= 5 ? "text-danger" : "text-muted-foreground")}>{product.stock <= 0 ? (product.sellWithoutStock ? "No stock" : "Out") : `${product.stock} left`}</span></span></button>)}</div>
        </section>
        <aside aria-label={t("Cart")} className="flex h-[42dvh] min-h-64 shrink-0 flex-col border-t bg-card lg:h-auto lg:min-h-0 lg:w-96 lg:border-s lg:border-t-0">
          <div className="flex items-center justify-between border-b px-3 py-3 sm:px-4"><h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="size-4" /> <LocalizedText value={"Cart "} /><span className="tabular text-sm text-muted-foreground">({itemCount})</span></h2><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => void loadHolds()}><List /> <LocalizedText value={"Holds"} /></Button><Button variant="ghost" size="sm" disabled={!lines.length || busy} onClick={() => void hold()}><PauseCircle /> <LocalizedText value={"Hold"} /></Button></div></div>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">{lines.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground"><LocalizedText value={"Cart is empty. Scan a barcode or tap an item."} /></li>}{lines.map((line) => { const id = keyOf(line.product); const quoted = quote?.lines?.find((entry) => entry.variantId === id); return <li key={id} className="grid gap-1 px-3 py-2"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{line.product.name}</p><p className="tabular text-xs text-muted-foreground">{formatMoney(quoted?.unitPriceCents ?? line.enteredPriceCents ?? line.product.priceMinor)}{quoted?.priceRuleName ? ` · ${quoted.priceRuleName}` : ""} · {taxLabel} {line.product.taxRate}%<LocalizedText value={line.product.includesTax ? " incl." : ""} /></p></div><div className="flex items-center gap-1"><Button variant="outline" size="icon" aria-label={`Decrease ${line.product.name}`} onClick={() => setQty(id, -1)}><Minus /></Button><span className="tabular w-7 text-center font-medium" aria-live="polite">{line.qty}</span><Button variant="outline" size="icon" aria-label={`Increase ${line.product.name}`} onClick={() => setQty(id, 1)}><Plus /></Button></div><Money minor={Math.max(0, Math.round((quoted?.unitPriceCents ?? line.enteredPriceCents ?? line.product.priceMinor) * line.qty * (1 - Math.min(100, Math.max(0, checkoutConfig.discounts.lineEnabled ? Number(line.discountPercent) || 0 : 0)) / 100)))} className="w-20 text-end" /><Button variant="ghost" size="icon" aria-label={`Remove ${line.product.name}`} onClick={() => remove(id)}><Trash2 /></Button></div>{line.product.openPrice && <Input aria-label={`Price for ${line.product.name}`} placeholder={`Enter price ${currencyCode()} (min ${formatMoney(line.product.floorPriceCents ?? 0)})`} inputMode="decimal" value={line.enteredPriceCents === undefined ? "" : toInput(line.enteredPriceCents)} onChange={(event) => setLinePrice(id, event.target.value)} />}<div className="grid grid-cols-2 gap-1"><Input hidden={!checkoutConfig.coreFields.includes("itemNote")} aria-label={`Note for ${line.product.name}`} placeholder="Line note" value={line.note} onChange={(event) => setLineNote(id, event.target.value)} /><Input hidden={!checkoutConfig.coreFields.includes("discount") || !checkoutConfig.discounts.lineEnabled} type="number" min="0" max={checkoutConfig.discounts.lineMaxPercent} step="0.01" aria-label={`Discount percentage for ${line.product.name}`} placeholder={`Line discount (up to ${checkoutConfig.discounts.lineMaxPercent}%)`} inputMode="decimal" value={line.discountPercent} onChange={(event) => setLineDiscount(id, event.target.value)} /></div></li>; })}</ul>
          <div className="space-y-1 border-t p-4">
            <div className="flex justify-between text-sm text-muted-foreground"><span><LocalizedText value={subtotalLabel} /></span><Money minor={totals.subtotalCents} className="font-normal" /></div>
            {totals.charges.map((charge) => <div key={charge.id} className="flex justify-between text-sm text-muted-foreground"><span>{charge.name}</span><Money minor={charge.amountCents} className="font-normal" /></div>)}
            {(quote?.promotions ?? []).map((promotion) => <div key={promotion.code} className="flex justify-between text-sm text-success"><span><LocalizedText value={"Offer "} />{promotion.code}</span><span className="tabular">−{formatMoney(promotion.discountCents)}</span></div>)}
            <div className="flex justify-between text-sm text-muted-foreground"><span><LocalizedText value={taxLabel} /></span><Money minor={totals.taxCents} className="font-normal" /></div>
            <div className="flex items-baseline justify-between pt-1"><span className="font-semibold"><LocalizedText value={"Total"} /></span><Money minor={total} className="text-2xl font-semibold" /></div>
            {quoteError && <p role="alert" className="text-xs text-danger">{quoteError}</p>}
            <Button size="touch" className="mt-3 w-full" disabled={!lines.length || busy || !priced} onClick={() => setPayOpen(true)}>{quoting ? <LocalizedText value={"Pricing…"} /> : <><LocalizedText value={"Pay "} />{lines.length ? formatMoney(total) : ""}</>}</Button>
          </div>
        </aside>
      </div>

      <Dialog open={openTill} onOpenChange={setOpenTill}><DialogContent><DialogTitle><LocalizedText value={"Open register"} /></DialogTitle><DialogDescription><LocalizedText value={"A register is the cash drawer you sell from. Opening it starts your shift: count the cash in the drawer and enter it as the opening float."} /></DialogDescription>{usableRegisters.length === 0 ? <div role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"><LocalizedText value={"This store has no active register yet, so a till cannot be opened. "} />{canAddRegister ? <Link href={`/org/stores/${storeId}`} className="font-medium underline"><LocalizedText value={"Add a register to this store"} /></Link> : "Ask an organisation administrator to add one."}</div> : <label className="grid gap-1 text-sm"><LocalizedText value={"Register"} /><select className="h-10 rounded-md border bg-background px-3" value={registerId} onChange={(event) => { setRegisterId(event.target.value); const open = usableRegisters.find((r) => r.id === event.target.value); if (open?.status === "OPEN") { setSessionId(open.sessionId); setOpenTill(false); } }}>{usableRegisters.map((register) => <option key={register.id} value={register.id}>{register.name}<LocalizedText value={register.status === "OPEN" ? " · already open: select to continue" : ""} /></option>)}</select></label>}<label className="grid gap-1 text-sm"><LocalizedText value={"Opening float ("} />{currencyCode()})<Input inputMode="decimal" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} /></label><Button onClick={() => void openSession()} disabled={busy || !registerId || usableRegisters.length === 0 || usableRegisters.find((r) => r.id === registerId)?.status === "OPEN"}><LocalizedText value={"Open register"} /></Button></DialogContent></Dialog>

      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}><DialogContent className="max-w-2xl"><DialogTitle><LocalizedText value={"Add items from the list"} /></DialogTitle><DialogDescription><LocalizedText value={"Search or filter, then tap Add. The window stays open so you can add several items."} /></DialogDescription>
        <div className={`grid gap-2${checkoutConfig.productCoreFields.includes("category") ? " sm:grid-cols-[1fr_12rem]" : ""}`}><Input autoFocus value={browseQuery} onChange={(event) => setBrowseQuery(event.target.value)} placeholder={searchableByBrand ? "Search name, SKU, brand or barcode" : "Search name, SKU or barcode"} aria-label="Search items" />{checkoutConfig.productCoreFields.includes("category") && <NativeSelect value={browseCategory} onChange={(event) => setBrowseCategory(event.target.value)} aria-label="Filter by category"><option value=""><LocalizedText value={"All categories"} /></option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect>}</div>
        <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">{browseList.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground"><LocalizedText value={"No items match."} /></li>}{browseList.map((product) => { const inCart = lines.find((l) => keyOf(l.product) === keyOf(product))?.qty ?? 0; return <li key={keyOf(product)} className="flex items-center gap-3 px-3 py-2 text-sm"><div className="min-w-0 flex-1"><p className="truncate font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.sku}{product.category ? ` · ${product.category}` : ""} · {product.stock <= 0 ? <LocalizedText value={product.sellWithoutStock ? "No stock on record" : "Out of stock"} /> : <LocalizedText value={`${formatNumber(product.stock, locale)} in stock`} />}</p></div>{inCart > 0 && <span className="text-xs text-muted-foreground">{formatNumber(inCart, locale)} <LocalizedText value={"in cart"} /></span>}<Money minor={product.priceMinor} /><Link href={`/s/${storeId}/products/${product.variantId ?? product.id}`} aria-label={`View ${product.name}`} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Info className="size-4" /></Link><Button size="sm" onClick={() => add(product)}><Plus /> <LocalizedText value={"Add"} /></Button></li>; })}</ul>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">{itemCount} <LocalizedText value={"item"} /><LocalizedText value={itemCount === 1 ? "" : "s"} /> <LocalizedText value={"in cart"} /></span><DialogClose asChild><Button><LocalizedText value={"Done"} /></Button></DialogClose></div></DialogContent></Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}><DialogContent><DialogTitle><LocalizedText value={"Take payment"} /></DialogTitle><DialogDescription><LocalizedText value={"The server prices and taxes the bill, and the invoice shows the same figures."} /></DialogDescription><p className="tabular text-3xl font-semibold">{formatMoney(total)}</p><div className="grid grid-cols-3 gap-2">{tenderOptions.map((value) => <Button key={value} size="touch" variant={tender === value ? "default" : "outline"} onClick={() => setTender(value)}><LocalizedText value={TENDER_LABELS[value] ?? value} /></Button>)}</div>{tender === "CASH" && <><Input placeholder={`Cash tendered (${currencyCode()})`} inputMode="decimal" value={cashTendered} onChange={(event) => setCashTendered(event.target.value)} />{cashTendered && toMinor(cashTendered) >= total && splitTender === "NONE" && <p className="text-sm"><LocalizedText value={"Change to return: "} /><b>{formatMoney(toMinor(cashTendered) - total)}</b></p>}</>}{tender !== "CASH" && <Input hidden={!checkoutConfig.coreFields.includes("paymentReference")} placeholder="Payment reference (optional)" value={reference} onChange={(event) => setReference(event.target.value)} />}{(tender === "CARD" || tender === "UPI") && splitTender === "NONE" && <div className="grid gap-2 rounded-md border p-3 text-sm"><div className="flex items-center justify-between gap-2"><span>{liveAttempt && liveAttempt.tenderType === tender ? <><LocalizedText value={"Online payment: "} /><LocalizedText value={liveAttempt.status === "CAPTURED" ? "Received" : liveAttempt.status === "FAILED" ? "Declined" : "Waiting for confirmation"} /></> : <LocalizedText value={"Charge through the payment gateway, or enter the slip reference above."} />}</span>{liveAttempt && (liveAttempt.status === "PENDING" || liveAttempt.status === "UNKNOWN") ? <Button size="sm" variant="outline" onClick={() => void checkAttempt()}><LocalizedText value={"Check status"} /></Button> : liveAttempt?.status === "CAPTURED" ? null : <Button size="sm" variant="outline" disabled={busy || !priced} onClick={() => void chargeOnline()}><LocalizedText value={"Charge "} />{formatMoney(total)}</Button>}</div></div>}<div hidden={!checkoutConfig.coreFields.includes("coupon") || !checkoutConfig.discounts.billEnabled} className="grid gap-1"><div className="flex gap-2"><Input aria-label="Coupon code" placeholder="Coupon code" value={couponInput} onChange={(event) => setCouponInput(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setCouponCode(couponInput.trim()); } }} /><Button variant="outline" onClick={() => setCouponCode(couponInput.trim())} disabled={couponInput.trim() === couponCode}><LocalizedText value={"Apply"} /></Button></div>{(quote?.rejectedPromotions ?? []).filter((entry) => entry.code === couponCode || (couponCode && entry.code.toUpperCase() === couponCode.toUpperCase())).map((entry) => <p key={entry.code} role="alert" className="text-xs text-danger"><LocalizedText value={REJECTION_TEXT[entry.reason] ?? "This code cannot be used"} /></p>)}{(quote?.promotions ?? []).map((promotion) => <p key={promotion.code} className="text-xs text-success"><LocalizedText value={"Offer "} />{promotion.code} <LocalizedText value={"applied: −"} />{formatMoney(promotion.discountCents)}</p>)}</div><NativeSelect hidden={!checkoutConfig.coreFields.includes("customer")} value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value=""><LocalizedText value={"No customer attached"} /></option>{customerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</option>)}</NativeSelect><Button hidden={!checkoutConfig.coreFields.includes("customer")} variant="outline" onClick={() => setCustomerCreateOpen(true)}><LocalizedText value={"Quick-create customer"} /></Button>{checkoutConfig.discounts.billEnabled && checkoutConfig.coreFields.includes("discount") && <Input type="number" min="0" max={checkoutConfig.discounts.billMaxPercent} step="0.01" aria-label="Bill discount percent" placeholder={`Bill discount (up to ${checkoutConfig.discounts.billMaxPercent}%)`} inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} />}{showDiscountReason && <label className="grid gap-1 text-sm"><span className="font-medium"><LocalizedText value={"Discount reason"} /><LocalizedText value={checkoutConfig.requireDiscountReasonCode ? " (required)" : ""} /></span><NativeSelect aria-label="Discount reason" value={discountReasonCode} onChange={(event) => setDiscountReasonCode(event.target.value)} required={checkoutConfig.requireDiscountReasonCode}><option value=""><LocalizedText value={checkoutConfig.requireDiscountReasonCode ? "Choose a reason" : "No reason selected"} /></option>{checkoutConfig.discountReasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.name}</option>)}</NativeSelect>{checkoutConfig.requireDiscountReasonCode && checkoutConfig.discountReasons.length === 0 && <span role="alert" className="text-xs text-danger"><LocalizedText value={"No active reason codes are configured. Ask a store manager to add one under Offers & price rules."} /></span>}</label>}<div hidden={!checkoutConfig.coreFields.includes("splitTender")} className="grid grid-cols-2 gap-2"><NativeSelect value={splitTender} onChange={(event) => setSplitTender(event.target.value as "NONE" | "CARD" | "UPI")}><option value="NONE"><LocalizedText value={"Single tender"} /></option><option value="CARD"><LocalizedText value={"Split with card"} /></option><option value="UPI"><LocalizedText value={"Split with UPI"} /></option></NativeSelect>{splitTender !== "NONE" && <Input placeholder={`First tender amount ${currencyCode()}`} inputMode="decimal" value={splitAmount} onChange={(event) => setSplitAmount(event.target.value)} />}</div><div className="grid gap-3 rounded-md border p-3"><label className="grid gap-1 text-sm"><span className="font-medium"><LocalizedText value={"Bill handled by"} /></span><NativeSelect aria-label="Bill handled by" required={checkoutConfig.requireBillHandler} value={handledById} onChange={(event) => setHandledById(event.target.value)}><option value=""><LocalizedText value={"Select a team member"} /></option>{checkoutConfig.handlers.map((handler) => <option key={handler.id} value={handler.id}>{handler.name}</option>)}</NativeSelect></label><ConfigurableFieldValues fields={checkoutConfig.fields} values={customFieldValues} onChange={setCustomFieldValues} idPrefix="checkout-field" /></div>{approvalNeeded && <div className="rounded-md border border-warning bg-warning-soft p-3"><p className="mb-2 text-sm font-medium"><LocalizedText value={"Manager approval required"} /></p><Input aria-label="Manager PIN" placeholder="Manager PIN" inputMode="numeric" type="password" value={managerPin} onChange={(event) => setManagerPin(event.target.value)} /></div>}<div className="flex justify-end gap-2"><DialogClose asChild><Button variant="outline"><LocalizedText value={"Cancel"} /></Button></DialogClose><Button onClick={() => void complete()} disabled={busy || !priced}><LocalizedText value={"Complete sale"} /></Button></div></DialogContent></Dialog>

      <Dialog open={Boolean(done)} onOpenChange={(open) => { if (!open) { setDone(null); setTimeout(() => searchRef.current?.focus(), 100); } }}><DialogContent><DialogTitle><LocalizedText value={"Sale complete"} /></DialogTitle><DialogDescription>{done?.receiptNumber ? <LocalizedText value={`Invoice ${done.receiptNumber}`} /> : <LocalizedText value={"The sale was recorded."} />}</DialogDescription><p className="tabular text-3xl font-semibold">{formatMoney(done?.totalCents ?? 0)}</p>{(done?.changeCents ?? 0) > 0 && <p className="text-sm"><LocalizedText value={"Change to return: "} /><b>{formatMoney(done?.changeCents ?? 0)}</b></p>}<div className="grid gap-2 sm:grid-cols-2"><Button asChild size="touch"><a href={done ? invoiceUrl(done.id) : "#"} target="_blank" rel="noreferrer" download={done ? `${done.receiptNumber || "invoice"}.pdf` : undefined}><Download /> <LocalizedText value={"Download invoice (PDF)"} /></a></Button><DialogClose asChild><Button size="touch" variant="outline"><LocalizedText value={"New sale"} /></Button></DialogClose></div></DialogContent></Dialog>

      <Dialog open={customerCreateOpen} onOpenChange={setCustomerCreateOpen}><DialogContent><DialogTitle><LocalizedText value={"Quick-create customer"} /></DialogTitle><DialogDescription><LocalizedText value={"Create a customer without leaving the till."} /></DialogDescription><Input placeholder="Name" value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} /><Input placeholder="Phone" value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} /><Button onClick={async () => { try { const created = await clientApi<Customer>("/pos/v1/customers", { method: "POST", body: JSON.stringify({ storeId, name: newCustomerName, phone: newCustomerPhone }) }); setCustomerOptions((current) => [...current, created]); setCustomerId(created.id); setNewCustomerName(""); setNewCustomerPhone(""); setCustomerCreateOpen(false); toast.success("Customer created"); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create customer"); } }}><LocalizedText value={"Create customer"} /></Button></DialogContent></Dialog>
      <Dialog open={holdsOpen} onOpenChange={setHoldsOpen}><DialogContent><DialogTitle><LocalizedText value={"Held sales"} /></DialogTitle><DialogDescription><LocalizedText value={"Resume a cart held at this store."} /></DialogDescription><div className="grid gap-2">{holds.length === 0 && <p className="text-sm text-muted-foreground"><LocalizedText value={"No held sales."} /></p>}{holds.map((held) => <Button key={held.id} variant="outline" className="justify-between" onClick={() => void resume(held.id)}><span>{formatDateTime(held.createdAt, locale)}</span><span>{held.payload?.lines?.length ?? 0} <LocalizedText value={"lines"} /></span></Button>)}</div></DialogContent></Dialog>
    </div>
  );
}

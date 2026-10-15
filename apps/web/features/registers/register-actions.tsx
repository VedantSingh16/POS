"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { ChevronDown, ChevronUp, CircleHelp, Landmark, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import { formatDateTime, formatMoney as formatMoneyValue, currencyCode, currencyNotes, minorPerUnit, toMinor } from "@/lib/format";
import { useLocale } from "@/components/i18n/locale-provider";

export type BoardRegister = { id: string; name: string; code?: string; status: string; sessionId: string; cashier: string; openedAt: string; expectedMinor: number; active: boolean };

const MOVEMENTS = [
  ["PAID_IN", "Cash in", "Money added to the drawer (e.g. change from the bank)"],
  ["PAID_OUT", "Cash out", "Money taken out for an expense"],
  ["DROP", "Cash drop", "Moving surplus cash to the safe"],
  ["PICKUP", "Pickup", "A manager collects cash from the drawer"],
] as const;

type PendingCashMovement = { storeId: string; registerId: string; sessionId: string; clientMovementId: string; type: string; amountCents: number; reason: string; createdAt: string; error?: string };
const cashQueueKey = (storeId: string) => `pos.pending-cash.${storeId}`;
function readCashQueue(storeId: string): PendingCashMovement[] {
  try {
    const value = JSON.parse(localStorage.getItem(cashQueueKey(storeId)) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((row): row is PendingCashMovement => Boolean(row && typeof row === "object" && (row as PendingCashMovement).storeId === storeId)) : [];
  } catch { return []; }
}

export function RegistersBoard({ storeId, registers }: { storeId: string; registers: BoardRegister[] }) {
  const [help, setHelp] = React.useState(false);
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="p-0">
          <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-start text-sm font-medium" aria-expanded={help} onClick={() => setHelp((v) => !v)}>
            <CircleHelp className="size-4 text-muted-foreground" /> <LocalizedText value={"Register help "} />{help ? <ChevronUp className="ms-auto size-4" /> : <ChevronDown className="ms-auto size-4" />}
          </button>
          {help && <div className="grid gap-3 border-t px-4 py-3 text-sm sm:grid-cols-3">
            <div><p className="font-medium"><LocalizedText value={"1. Register = a till"} /></p><p className="text-muted-foreground"><LocalizedText value={"The physical cash drawer at a counter, for example “Front Till”. It is set up once for the store."} /></p></div>
            <div><p className="font-medium"><LocalizedText value={"2. Open it to start a shift"} /></p><p className="text-muted-foreground"><LocalizedText value={"Count the cash already in the drawer and enter it as the opening float. Sales can only be taken while a register is open."} /></p></div>
            <div><p className="font-medium"><LocalizedText value={"3. Close it to end the shift"} /></p><p className="text-muted-foreground"><LocalizedText value={"Count the cash without looking at the expected figure. The difference (variance) is recorded and raises an alert if it is not zero."} /></p></div>
            <p className="text-muted-foreground sm:col-span-3"><LocalizedText value={"The "} /><b><LocalizedText value={"Point of sale"} /></b> <LocalizedText value={"screen is where cashiers scan items and take payment all day. A "} /><b><LocalizedText value={"register"} /></b> <LocalizedText value={"is the cash drawer that screen sells from. The POS needs an open register; this page opens and closes it and records cash moved in or out."} /></p>
          </div>}
        </CardContent>
      </Card>
      {registers.length === 0 && <Card><CardContent className="p-6 text-center text-sm text-muted-foreground"><LocalizedText value={"This store has no register yet. An organisation administrator can add one from Organisation → Stores."} /></CardContent></Card>}
      <div className="grid gap-4 lg:grid-cols-2">{registers.map((register) => <RegisterCard key={register.id} storeId={storeId} register={register} />)}</div>
    </div>
  );
}

function RegisterCard({ storeId, register }: { storeId: string; register: BoardRegister }) {
  const router = useRouter();
  const { locale } = useLocale();
  const formatMoney = (minor: number) => formatMoneyValue(minor, locale);
  const isOpen = register.status === "OPEN";
  const [busy, setBusy] = React.useState(false);
  const [panel, setPanel] = React.useState<"" | "cash" | "close">("");
  const [float, setFloat] = React.useState("");
  const [type, setType] = React.useState<(typeof MOVEMENTS)[number][0]>("PAID_IN");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [managerPin, setManagerPin] = React.useState("");
  const [closeReason, setCloseReason] = React.useState("");
  const [closeManagerPin, setCloseManagerPin] = React.useState("");
  const movementId = React.useRef("");
  const [pendingMovements, setPendingMovements] = React.useState<PendingCashMovement[]>([]);
  const [counts, setCounts] = React.useState<Record<number, string>>({});
  const [coins, setCoins] = React.useState("");
  const [total, setTotal] = React.useState("");
  const NOTES = currencyNotes(); // note values of the organisation's currency, in whole units
  const [mode, setMode] = React.useState<"notes" | "total">("notes");

  const countedCents = mode === "total"
    ? toMinor(total || 0)
    : NOTES.reduce((sum, note) => sum + Math.round(note * minorPerUnit()) * Math.max(0, Math.floor(Number(counts[note] || 0))), 0) + toMinor(coins || 0);

  // Hydrate the durable browser queue after hydration to avoid a server/client markup mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { setPendingMovements(readCashQueue(storeId)); }, [storeId]);

  const storeQueue = React.useCallback((update: (items: PendingCashMovement[]) => PendingCashMovement[]) => {
    const next = update(readCashQueue(storeId));
    try { localStorage.setItem(cashQueueKey(storeId), JSON.stringify(next)); setPendingMovements(next); return true; }
    catch { toast.error("This browser could not save the pending cash movement. Keep this page open and retry when connected."); return false; }
  }, [storeId]);

  const retryPending = React.useCallback(async () => {
    if (!navigator.onLine) { toast.error("The device is still offline."); return; }
    const queued = readCashQueue(storeId).filter((item) => item.registerId === register.id);
    if (!queued.length) return;
    setBusy(true);
    for (const item of queued) {
      try {
        await clientApi(`/pos/v1/sessions/${item.sessionId}/cash`, { method: "POST", headers: { "x-store-id": storeId }, body: JSON.stringify({ type: item.type, amountCents: item.amountCents, reason: item.reason, clientMovementId: item.clientMovementId, ...(managerPin ? { managerPin } : {}) }) });
        storeQueue((items) => items.filter((row) => row.clientMovementId !== item.clientMovementId));
        toast.success(`Pending cash movement from ${formatDateTime(item.createdAt, locale)} synced.`);
        router.refresh();
      } catch (error) {
        const detail = error as Error & { status?: number; payload?: { code?: string } };
        const message = detail.payload?.code === "REQUIRE_APPROVAL" ? "Manager approval is required. Enter a manager PIN and retry." : detail.message || "Sync failed; the movement remains queued.";
        storeQueue((items) => items.map((row) => row.clientMovementId === item.clientMovementId ? { ...row, error: message } : row));
      }
    }
    setBusy(false);
  }, [locale, managerPin, register.id, router, storeId, storeQueue]);

  const retryPendingRef = React.useRef(retryPending);
  React.useEffect(() => { retryPendingRef.current = retryPending; }, [retryPending]);
  React.useEffect(() => {
    const onOnline = () => { window.setTimeout(() => { void retryPendingRef.current(); }, 0); };
    window.addEventListener("online", onOnline);
    const retryTimer = navigator.onLine ? window.setTimeout(() => { void retryPendingRef.current(); }, 0) : undefined;
    return () => { window.removeEventListener("online", onOnline); if (retryTimer !== undefined) window.clearTimeout(retryTimer); };
  }, [storeId, register.id]);

  async function act(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    try { const result = await task(); toast.success(success); setPanel(""); router.refresh(); return result; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Register action failed"); }
    finally { setBusy(false); }
  }

  const open = () => {
    if (!float.trim()) { toast.error("Enter the counted opening float. Enter 0 if the drawer is empty."); return; }
    return act(() => clientApi("/pos/v1/sessions", { method: "POST", body: JSON.stringify({ storeId, registerId: register.id, openingFloatCents: toMinor(float) }) }), `${register.name} is open. You can start selling.`);
  };
  const record = async () => {
    const cents = toMinor(amount);
    if (!Number.isInteger(cents) || cents <= 0) { toast.error("Enter an amount greater than zero."); return; }
    if (!reason.trim()) { toast.error("Add a short reason so the cash can be traced."); return; }
    if (!movementId.current) movementId.current = crypto.randomUUID();
    setBusy(true);
    const queuedItem: PendingCashMovement = { storeId, registerId: register.id, sessionId: register.sessionId, type, amountCents: cents, reason: reason.trim(), clientMovementId: movementId.current, createdAt: new Date().toISOString() };
    try {
      await clientApi(`/pos/v1/sessions/${register.sessionId}/cash`, { method: "POST", headers: { "x-store-id": storeId }, body: JSON.stringify({ type, amountCents: cents, reason: reason.trim(), managerPin: managerPin || undefined, clientMovementId: movementId.current }) });
      toast.success("Cash movement recorded"); setPanel(""); router.refresh(); setAmount(""); setReason(""); setManagerPin(""); movementId.current = "";
    } catch (error) {
      const detail = error as Error & { status?: number; payload?: { code?: string } };
      if (!managerPin && (detail.status === undefined || detail.status >= 500)) {
        const saved = storeQueue((items) => items.some((row) => row.clientMovementId === queuedItem.clientMovementId) ? items : [...items, queuedItem]);
        if (saved) { toast.warning("Movement is pending sync. It is not recorded in the register ledger yet."); setAmount(""); setReason(""); movementId.current = ""; }
      } else toast.error(detail.message || "Cash movement failed");
    } finally { setBusy(false); }
  };
  const close = async () => {
    if (mode === "notes" && countedCents === 0 && !window.confirm(`The count is ${formatMoney(0)}. Close the register with an empty drawer?`)) return;
    const body = mode === "notes"
      ? { countedCashCents: countedCents, denominations: [...NOTES.map((note) => ({ denominationCents: Math.round(note * minorPerUnit()), count: Math.max(0, Math.floor(Number(counts[note] || 0))) })).filter((item) => item.count > 0), ...(Number(coins || 0) > 0 ? [{ denominationCents: 1, count: toMinor(coins) }] : [])] }
      : { countedCashCents: countedCents };
    Object.assign(body, { reason: closeReason.trim() || undefined, managerPin: closeManagerPin || undefined });
    if (mode === "notes" && (body.denominations as unknown[]).length === 0) delete (body as { denominations?: unknown }).denominations;
    setBusy(true);
    try {
      const result = await clientApi<{ expectedCashCents: number; countedCashCents: number; varianceCents: number }>(`/pos/v1/sessions/${register.sessionId}/close`, { method: "POST", headers: { "x-store-id": storeId }, body: JSON.stringify(body) });
      const v = result.varianceCents;
      toast.success(`Register closed. Counted ${formatMoney(result.countedCashCents)}, expected ${formatMoney(result.expectedCashCents)}${v === 0 ? " — no difference." : `, difference ${v > 0 ? "+" : ""}${formatMoney(v)}.`}`, { duration: 9000 });
      setPanel(""); router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not close the register"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 p-4">
        {pendingMovements.filter((item) => item.registerId === register.id).map((item) => <div key={item.clientMovementId} className="flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-sm"><div className="min-w-48 flex-1"><p className="font-medium"><LocalizedText value={"Cash movement pending · "} />{formatMoney(item.amountCents)}</p><p className="text-xs text-muted-foreground"><LocalizedText value={MOVEMENTS.find(([value]) => value === item.type)?.[1] ?? item.type.replaceAll("_", " ")} /> · {item.reason} · {formatDateTime(item.createdAt, locale)}</p>{item.error && <p className="text-xs text-warning">{item.error}</p>}</div><Button size="sm" variant="outline" disabled={busy} onClick={() => void retryPending()}><LocalizedText value={"Retry sync"} /></Button></div>)}
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-secondary"><Landmark className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{register.name} {register.code && <span className="text-xs font-normal text-muted-foreground">· {register.code}</span>}</p>
            <p className="text-sm text-muted-foreground">{!register.active ? <LocalizedText value="Deactivated: it cannot be opened." /> : isOpen ? <><LocalizedText value="Open" />{register.cashier && register.cashier !== "—" ? <> · <LocalizedText value="cashier" /> {register.cashier}</> : null}</> : <LocalizedText value="Closed: no sales can be taken on this till." />}</p>
          </div>
          <Badge tone={!register.active ? "neutral" : isOpen ? "success" : "warning"}><LocalizedText value={!register.active ? "Inactive" : isOpen ? "Open" : "Closed"} /></Badge>
        </div>

        {isOpen && <div className="grid grid-cols-2 gap-3 rounded-md bg-secondary/60 p-3 text-sm"><div><p className="text-xs text-muted-foreground"><LocalizedText value={"Cash expected in drawer"} /></p><p className="tabular text-lg font-semibold">{formatMoney(register.expectedMinor)}</p></div><div><p className="text-xs text-muted-foreground"><LocalizedText value={"Opened"} /></p><p className="font-medium">{register.openedAt ? formatDateTime(register.openedAt, locale) : "—"}</p></div></div>}

        {!isOpen && register.active && <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="grid gap-1 text-sm"><LocalizedText value={"Opening float ("} />{currencyCode()})<Input value={float} onChange={(e) => setFloat(e.target.value)} inputMode="decimal" aria-describedby={`float-${register.id}`} /><span id={`float-${register.id}`} className="text-xs text-muted-foreground"><LocalizedText value={"Enter the cash counted before the first sale. Enter 0 for an empty drawer."} /></span></label>
          <Button disabled={busy || !float.trim()} onClick={() => void open()}><LocalizedText value={"Open register"} /></Button>
        </div>}

        {isOpen && <div className="flex flex-wrap gap-2">
          <Button asChild><Link href={`/s/${storeId}/pos`}><ShoppingCart /> <LocalizedText value={"Go to POS"} /></Link></Button>
          <Button variant="outline" onClick={() => setPanel(panel === "cash" ? "" : "cash")}><LocalizedText value={"Cash in / out"} /></Button>
          <Button variant="outline" onClick={() => setPanel(panel === "close" ? "" : "close")}><LocalizedText value={"Close register"} /></Button>
        </div>}

        {isOpen && panel === "cash" && <div className="grid gap-3 rounded-md border p-3">
          <p className="text-sm font-medium"><LocalizedText value={"Record cash moved in or out of the drawer"} /></p>
          <label className="grid gap-1 text-sm"><LocalizedText value={"What happened"} /><NativeSelect value={type} onChange={(e) => setType(e.target.value as typeof type)}>{MOVEMENTS.map(([value, label]) => <option key={value} value={value}><LocalizedText value={label} /></option>)}</NativeSelect><span className="text-xs text-muted-foreground"><LocalizedText value={MOVEMENTS.find(([value]) => value === type)?.[2] ?? ""} /></span></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm"><LocalizedText value={"Amount ("} />{currencyCode()})<Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label><label className="grid gap-1 text-sm"><LocalizedText value={"Reason"} /><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tea for staff" /></label></div>
          <label className="grid gap-1 text-sm"><LocalizedText value={"Manager PIN (required above the configured amount)"} /><Input type="password" inputMode="numeric" autoComplete="off" value={managerPin} onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))} /></label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPanel("")}><LocalizedText value={"Cancel"} /></Button><Button disabled={busy} onClick={record}><LocalizedText value={"Record"} /></Button></div>
        </div>}

        {isOpen && panel === "close" && <div className="grid gap-3 rounded-md border p-3">
          <div><p className="text-sm font-medium"><LocalizedText value={"Count the cash in the drawer"} /></p><p className="text-xs text-muted-foreground"><LocalizedText value={"The expected amount is hidden on purpose so the count is honest. The difference is shown after closing."} /></p></div>
          <div className="flex gap-1 text-sm"><Button size="sm" variant={mode === "notes" ? "default" : "outline"} onClick={() => setMode("notes")}><LocalizedText value={"Count by notes"} /></Button><Button size="sm" variant={mode === "total" ? "default" : "outline"} onClick={() => setMode("total")}><LocalizedText value={"Enter a total"} /></Button></div>
          {mode === "notes" ? <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{NOTES.map((note) => <label key={note} className="grid gap-1 text-xs font-medium">{formatMoney(Math.round(note * minorPerUnit()))} <LocalizedText value={"notes"} /><Input aria-label={`Number of ${note} ${currencyCode()} notes`} inputMode="numeric" value={counts[note] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [note]: e.target.value }))} placeholder="0" /></label>)}<label className="grid gap-1 text-xs font-medium"><LocalizedText value={"Coins, total ("} />{currencyCode()})<Input aria-label="Coins total" inputMode="decimal" value={coins} onChange={(e) => setCoins(e.target.value)} placeholder="0" /></label></div>
          </div> : <label className="grid gap-1 text-sm"><LocalizedText value={"Total counted ("} />{currencyCode()})<Input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" /></label>}
          <p className="text-sm"><LocalizedText value={"Counted total: "} /><b className="tabular">{formatMoney(countedCents)}</b></p>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm"><LocalizedText value={"Reason for variance (if any)"} /><Input value={closeReason} onChange={(e) => setCloseReason(e.target.value)} /></label><label className="grid gap-1 text-sm"><LocalizedText value={"Manager PIN (required outside tolerance)"} /><Input type="password" inputMode="numeric" autoComplete="off" value={closeManagerPin} onChange={(e) => setCloseManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))} /></label></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPanel("")}><LocalizedText value={"Cancel"} /></Button><Button disabled={busy} onClick={() => void close()}><LocalizedText value={"Close register"} /></Button></div>
        </div>}
      </CardContent>
    </Card>
  );
}

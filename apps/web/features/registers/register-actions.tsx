"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, CircleHelp, Landmark, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import { formatMoney } from "@/lib/format";

export type BoardRegister = { id: string; name: string; code?: string; status: string; sessionId: string; cashier: string; openedAt: string; expectedMinor: number; active: boolean };

const NOTES = [2000, 500, 200, 100, 50, 20, 10] as const;
const MOVEMENTS = [
  ["PAID_IN", "Cash in", "Money added to the drawer (e.g. change from the bank)"],
  ["PAID_OUT", "Cash out", "Money taken out for an expense"],
  ["DROP", "Cash drop", "Moving surplus cash to the safe"],
  ["PICKUP", "Pickup", "A manager collects cash from the drawer"],
] as const;

export function RegistersBoard({ storeId, registers }: { storeId: string; registers: BoardRegister[] }) {
  const [help, setHelp] = React.useState(registers.every((r) => r.status !== "OPEN"));
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="p-0">
          <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium" aria-expanded={help} onClick={() => setHelp((v) => !v)}>
            <CircleHelp className="size-4 text-muted-foreground" /> How registers work {help ? <ChevronUp className="ml-auto size-4" /> : <ChevronDown className="ml-auto size-4" />}
          </button>
          {help && <div className="grid gap-3 border-t px-4 py-3 text-sm sm:grid-cols-3">
            <div><p className="font-medium">1. Register = a till</p><p className="text-muted-foreground">The physical cash drawer at a counter, for example “Front Till”. It is set up once for the store.</p></div>
            <div><p className="font-medium">2. Open it to start a shift</p><p className="text-muted-foreground">Count the cash already in the drawer and enter it as the opening float. Sales can only be taken while a register is open.</p></div>
            <div><p className="font-medium">3. Close it to end the shift</p><p className="text-muted-foreground">Count the cash without looking at the expected figure. The difference (variance) is recorded and raises an alert if it is not zero.</p></div>
            <p className="text-muted-foreground sm:col-span-3">The <b>Point of sale</b> screen is where cashiers scan items and take payment all day. A <b>register</b> is the cash drawer that screen sells from. The POS needs an open register; this page opens and closes it and records cash moved in or out.</p>
          </div>}
        </CardContent>
      </Card>
      {registers.length === 0 && <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">This store has no register yet. An organisation administrator can add one from Organisation → Stores.</CardContent></Card>}
      <div className="grid gap-4 lg:grid-cols-2">{registers.map((register) => <RegisterCard key={register.id} storeId={storeId} register={register} />)}</div>
    </div>
  );
}

function RegisterCard({ storeId, register }: { storeId: string; register: BoardRegister }) {
  const router = useRouter();
  const isOpen = register.status === "OPEN";
  const [busy, setBusy] = React.useState(false);
  const [panel, setPanel] = React.useState<"" | "cash" | "close">("");
  const [float, setFloat] = React.useState("0");
  const [type, setType] = React.useState<(typeof MOVEMENTS)[number][0]>("PAID_IN");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [counts, setCounts] = React.useState<Record<number, string>>({});
  const [coins, setCoins] = React.useState("");
  const [total, setTotal] = React.useState("");
  const [mode, setMode] = React.useState<"notes" | "total">("notes");

  const countedCents = mode === "total"
    ? Math.round(Number(total || 0) * 100)
    : NOTES.reduce((sum, note) => sum + note * 100 * Math.max(0, Math.floor(Number(counts[note] || 0))), 0) + Math.round(Number(coins || 0) * 100);

  async function act(task: () => Promise<unknown>, success: string) {
    setBusy(true);
    try { const result = await task(); toast.success(success); setPanel(""); router.refresh(); return result; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Register action failed"); }
    finally { setBusy(false); }
  }

  const open = () => act(() => clientApi("/pos/v1/sessions", { method: "POST", body: JSON.stringify({ storeId, registerId: register.id, openingFloatCents: Math.round(Number(float || 0) * 100) }) }), `${register.name} is open. You can start selling.`);
  const record = () => {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isInteger(cents) || cents <= 0) { toast.error("Enter an amount greater than zero."); return; }
    if (!reason.trim()) { toast.error("Add a short reason so the cash can be traced."); return; }
    void act(() => clientApi(`/pos/v1/sessions/${register.sessionId}/cash`, { method: "POST", headers: { "x-store-id": storeId }, body: JSON.stringify({ type, amountCents: cents, reason: reason.trim() }) }), "Cash movement recorded").then(() => { setAmount(""); setReason(""); });
  };
  const close = async () => {
    if (mode === "notes" && countedCents === 0 && !window.confirm("The count is ₹0.00. Close the register with an empty drawer?")) return;
    const body = mode === "notes"
      ? { countedCashCents: countedCents, denominations: [...NOTES.map((note) => ({ denominationCents: note * 100, count: Math.max(0, Math.floor(Number(counts[note] || 0))) })).filter((item) => item.count > 0), ...(Number(coins || 0) > 0 ? [{ denominationCents: 1, count: Math.round(Number(coins) * 100) }] : [])] }
      : { countedCashCents: countedCents };
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
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-secondary"><Landmark className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{register.name} {register.code && <span className="text-xs font-normal text-muted-foreground">· {register.code}</span>}</p>
            <p className="text-sm text-muted-foreground">{!register.active ? "Deactivated: it cannot be opened." : isOpen ? `Open${register.cashier && register.cashier !== "—" ? ` · cashier ${register.cashier}` : ""}` : "Closed: no sales can be taken on this till."}</p>
          </div>
          <Badge tone={!register.active ? "neutral" : isOpen ? "success" : "warning"}>{!register.active ? "Inactive" : isOpen ? "Open" : "Closed"}</Badge>
        </div>

        {isOpen && <div className="grid grid-cols-2 gap-3 rounded-md bg-secondary/60 p-3 text-sm"><div><p className="text-xs text-muted-foreground">Cash expected in drawer</p><p className="tabular text-lg font-semibold">{formatMoney(register.expectedMinor)}</p></div><div><p className="text-xs text-muted-foreground">Opened</p><p className="font-medium">{register.openedAt ? new Date(register.openedAt).toLocaleString() : "—"}</p></div></div>}

        {!isOpen && register.active && <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="grid gap-1 text-sm">Opening float (₹)<Input value={float} onChange={(e) => setFloat(e.target.value)} inputMode="decimal" aria-describedby={`float-${register.id}`} /><span id={`float-${register.id}`} className="text-xs text-muted-foreground">The cash you counted in the drawer before the first sale.</span></label>
          <Button disabled={busy} onClick={() => void open()}>Open register</Button>
        </div>}

        {isOpen && <div className="flex flex-wrap gap-2">
          <Button asChild><Link href={`/s/${storeId}/pos`}><ShoppingCart /> Go to POS</Link></Button>
          <Button variant="outline" onClick={() => setPanel(panel === "cash" ? "" : "cash")}>Cash in / out</Button>
          <Button variant="outline" onClick={() => setPanel(panel === "close" ? "" : "close")}>Close register</Button>
        </div>}

        {isOpen && panel === "cash" && <div className="grid gap-3 rounded-md border p-3">
          <p className="text-sm font-medium">Record cash moved in or out of the drawer</p>
          <label className="grid gap-1 text-sm">What happened<NativeSelect value={type} onChange={(e) => setType(e.target.value as typeof type)}>{MOVEMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect><span className="text-xs text-muted-foreground">{MOVEMENTS.find(([value]) => value === type)?.[2]}</span></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Amount (₹)<Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label><label className="grid gap-1 text-sm">Reason<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tea for staff" /></label></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPanel("")}>Cancel</Button><Button disabled={busy} onClick={record}>Record</Button></div>
        </div>}

        {isOpen && panel === "close" && <div className="grid gap-3 rounded-md border p-3">
          <div><p className="text-sm font-medium">Count the cash in the drawer</p><p className="text-xs text-muted-foreground">The expected amount is hidden on purpose so the count is honest. The difference is shown after closing.</p></div>
          <div className="flex gap-1 text-sm"><Button size="sm" variant={mode === "notes" ? "default" : "outline"} onClick={() => setMode("notes")}>Count by notes</Button><Button size="sm" variant={mode === "total" ? "default" : "outline"} onClick={() => setMode("total")}>Enter a total</Button></div>
          {mode === "notes" ? <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{NOTES.map((note) => <label key={note} className="grid gap-1 text-xs font-medium">₹{note} notes<Input aria-label={`Number of ₹${note} notes`} inputMode="numeric" value={counts[note] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [note]: e.target.value }))} placeholder="0" /></label>)}<label className="grid gap-1 text-xs font-medium">Coins, total ₹<Input aria-label="Coins total in rupees" inputMode="decimal" value={coins} onChange={(e) => setCoins(e.target.value)} placeholder="0" /></label></div>
          </div> : <label className="grid gap-1 text-sm">Total counted (₹)<Input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" /></label>}
          <p className="text-sm">Counted total: <b className="tabular">{formatMoney(countedCents)}</b></p>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPanel("")}>Cancel</Button><Button disabled={busy} onClick={() => void close()}>Close register</Button></div>
        </div>}
      </CardContent>
    </Card>
  );
}

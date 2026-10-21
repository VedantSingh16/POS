"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect, PasswordInput } from "@/components/ui/input";
import { Money } from "@/components/data/primitives";
import { clientApi } from "@/features/client-api";

type Sale = { id: string; receiptNumber: string; lines: { id: string; name: string; sku: string; quantity: number; lineTotalCents: number }[] };
type Session = { id: string; registerName: string };

export function ReturnForm({ storeId, sessions }: { storeId: string; sessions: Session[] }) {
  const [receipt, setReceipt] = React.useState("");
  const [sale, setSale] = React.useState<Sale | null>(null);
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [status, setStatus] = React.useState("");
  const [reason, setReason] = React.useState("Customer return");
  const [restockStatus, setRestockStatus] = React.useState("SELLABLE");
  const [tenderType, setTenderType] = React.useState("CASH");
  const [managerPin, setManagerPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function findReceipt() {
    setBusy(true); setStatus("");
    try {
      const headers = { "x-store-id": storeId };
      const result = await clientApi<{ sales: { id: string }[] }>(`/pos/v1/sales?storeId=${encodeURIComponent(storeId)}&receipt=${encodeURIComponent(receipt)}`, { headers });
      if (!result.sales[0]) { setStatus("No matching receipt found."); return; }
      const detail = await clientApi<Sale>(`/pos/v1/sales/${result.sales[0].id}`, { headers }); setSale(detail); setQuantities({});
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not find receipt"); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!sale || !sessions[0]) { setStatus("An open register is required to process a refund."); return; }
    const lines = sale.lines.filter((line) => (quantities[line.id] ?? 0) > 0).map((line) => ({ saleLineId: line.id, quantity: quantities[line.id], restockStatus }));
    if (!lines.length) { setStatus("Choose at least one line and quantity."); return; }
    setBusy(true); setStatus("");
    try { const result = await clientApi<{ creditNoteNumber: string; totalCents: number }>("/pos/v1/returns", { method: "POST", headers: { "x-store-id": storeId }, body: JSON.stringify({ storeId, saleId: sale.id, sessionId: sessions[0].id, lines, reason, tenderType, ...(managerPin ? { managerPin } : {}) }) }); toast.success(`Return ${result.creditNoteNumber} completed`); setSale(null); setReceipt(""); setManagerPin(""); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Could not complete return"); }
    finally { setBusy(false); }
  }

  return <Card className="max-w-3xl"><CardContent className="grid gap-5 p-5">
    <div className="flex gap-2"><Input value={receipt} onChange={(event) => setReceipt(event.target.value)} placeholder="TAX-YYYYMMDD-0000" aria-label="Receipt number" /><Button onClick={() => void findReceipt()} disabled={busy || !receipt.trim()}><LocalizedText value={"Find receipt"} /></Button></div>
    {sale && <div className="grid gap-3"><p className="font-medium">{sale.receiptNumber}</p>{sale.lines.map((line) => <div key={line.id} className="flex items-center gap-3 rounded-md border p-3"><div className="min-w-0 flex-1"><p className="font-medium">{line.name}</p><p className="text-xs text-muted-foreground">{line.sku} <LocalizedText value={"· sold "} />{line.quantity}</p></div><Money minor={line.lineTotalCents} /><Input className="w-24" type="number" min="0" max={line.quantity} value={quantities[line.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: Math.min(line.quantity, Math.max(0, Number(event.target.value) || 0)) }))} aria-label={`Return quantity for ${line.name}`} /></div>)}
      <div className="grid gap-3 sm:grid-cols-4"><label className="grid gap-1 text-sm"><LocalizedText value={"Reason"} /><Input value={reason} onChange={(event) => setReason(event.target.value)} /></label><label className="grid gap-1 text-sm"><LocalizedText value={"Restock"} /><NativeSelect value={restockStatus} onChange={(event) => setRestockStatus(event.target.value)}><option value="SELLABLE"><LocalizedText value={"Sellable"} /></option><option value="DAMAGED"><LocalizedText value={"Damaged"} /></option></NativeSelect></label><label className="grid gap-1 text-sm"><LocalizedText value={"Refund tender"} /><NativeSelect value={tenderType} onChange={(event) => setTenderType(event.target.value)}><option value="CASH"><LocalizedText value={"Cash"} /></option><option value="CARD"><LocalizedText value={"Card"} /></option><option value="UPI"><LocalizedText value={"UPI"} /></option></NativeSelect></label><label className="grid gap-1 text-sm"><LocalizedText value={"Manager PIN if required"} /><PasswordInput secret="PIN" inputMode="numeric" value={managerPin} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, "").slice(0, 8))} /></label></div>
      <Button onClick={() => void submit()} disabled={busy}><LocalizedText value={"Complete refund"} /></Button>
    </div>}
    {status && <p role="alert" className="text-sm text-danger">{status}</p>}
  </CardContent></Card>;
}

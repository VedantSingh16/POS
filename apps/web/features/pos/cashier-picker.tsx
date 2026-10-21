"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput } from "@/components/ui/input";
import { LocalizedText } from "@/components/i18n/localized-text";

export type CashierOption = { id: string; name: string; employeeCode?: string };

export function CashierPicker({ open, cashiers, pinRequired, selectedId, busy, onSelect, onClose }: {
  open: boolean;
  cashiers: CashierOption[];
  pinRequired: boolean;
  selectedId?: string;
  busy?: boolean;
  onSelect: (cashier: CashierOption, pin?: string) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [pinTarget, setPinTarget] = React.useState<CashierOption | null>(null);
  if (!open) return null;
  const visible = cashiers.filter((cashier) => `${cashier.name} ${cashier.employeeCode ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Choose cashier">
      <div className="grid max-h-[90dvh] w-full max-w-2xl gap-4 overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold"><LocalizedText value="Choose cashier" /></h2><p className="text-sm text-muted-foreground"><LocalizedText value={pinRequired ? "Enter the cashier PIN to start or switch a bill." : "Select the person responsible for the next bill."} /></p></div>{onClose && <Button variant="ghost" onClick={onClose}><LocalizedText value="Cancel" /></Button>}</div>
        {cashiers.length > 12 && <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cashier name or employee code" aria-label="Search cashier" />}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visible.map((cashier) => <Button key={cashier.id} variant={cashier.id === selectedId ? "default" : "outline"} className="h-auto min-h-16 justify-start text-start" disabled={busy} onClick={() => { if (pinRequired) { setPinTarget(cashier); setPin(""); } else { onSelect(cashier); } }}><span className="grid"><span>{cashier.name}</span>{cashier.employeeCode && <span className="text-xs opacity-70">{cashier.employeeCode}</span>}</span></Button>)}{visible.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground"><LocalizedText value="No active cashiers match." /></p>}</div>
        {pinRequired && pinTarget && <div className="grid gap-2 rounded-lg border p-3"><label className="grid gap-1 text-sm font-medium"><LocalizedText value={`PIN for ${pinTarget.name}`} /><PasswordInput secret="PIN" autoFocus inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} /></label><Button disabled={busy || !/^\d{4,8}$/.test(pin)} onClick={() => { onSelect(pinTarget, pin); setPin(""); }}>{busy ? <LocalizedText value="Checking…" /> : <LocalizedText value={`Verify ${pinTarget.name}`} />}</Button></div>}
      </div>
    </div>
  );
}

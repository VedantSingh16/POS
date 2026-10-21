"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput } from "@/components/ui/input";
import { StatusBadge } from "@/components/data/primitives";
import { clientApi } from "@/features/client-api";
import { toast } from "@/lib/i18n/toast";

type Cashier = { id: string; displayName: string; employeeCode: string; status: string; hasPin: boolean; lastSelectedAt?: string | null };
type Till = { exists: boolean; id?: string; loginId: string; status?: string; activeSessions?: number };

export function StoreCashiersPanel({ storeId, initialCashiers, initialTill, canManage }: { storeId: string; initialCashiers: Cashier[]; initialTill: Till; canManage: boolean }) {
  const [cashiers, setCashiers] = React.useState(initialCashiers);
  const [till, setTill] = React.useState(initialTill);
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function addCashier() {
    if (!name.trim()) return;
    setBusy(true);
    try { const created = await clientApi<Cashier>(`/admin/stores/${storeId}/cashiers`, { method: "POST", body: JSON.stringify({ displayName: name.trim(), employeeCode: code.trim(), pin: pin || undefined }) }); setCashiers((current) => [...current, created]); setName(""); setCode(""); setPin(""); toast.success("Cashier added"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not add cashier"); }
    finally { setBusy(false); }
  }
  async function updateCashier(cashier: Cashier, patch: Record<string, unknown>) {
    setBusy(true);
    try { const updated = await clientApi<Cashier>(`/admin/stores/${storeId}/cashiers/${cashier.id}`, { method: "PATCH", body: JSON.stringify(patch) }); setCashiers((current) => current.map((row) => row.id === updated.id ? updated : row)); setEditing(null); toast.success("Cashier updated"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not update cashier"); }
    finally { setBusy(false); }
  }
  async function importCashiers() {
    setBusy(true);
    try { const result = await clientApi<{ imported: Cashier[] }>(`/admin/stores/${storeId}/cashiers/import`, { method: "POST", body: JSON.stringify({}) }); setCashiers((current) => [...current, ...(result.imported ?? [])]); toast.success(`${result.imported?.length ?? 0} cashier names imported`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not import cashiers"); }
    finally { setBusy(false); }
  }
  async function signOutAllTills() {
    setBusy(true);
    try { const next = await clientApi<Till>(`/admin/stores/${storeId}/till/reset`, { method: "POST", body: JSON.stringify({}) }); setTill(next); toast.success("All till sessions signed out"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not sign out tills"); }
    finally { setBusy(false); }
  }
  async function saveTill() {
    if (!password || password.length < 12 || (!till.exists && !password)) { toast.error("Enter a till password of at least 12 characters"); return; }
    setBusy(true);
    try { const next = await clientApi<Till>(till.exists ? `/admin/stores/${storeId}/till/reset` : `/admin/stores/${storeId}/till`, { method: "POST", body: JSON.stringify({ password, pin: pin || undefined }) }); setTill(next); setPassword(""); setPin(""); toast.success(till.exists ? "Till credentials reset" : "Till login created"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not save till login"); }
    finally { setBusy(false); }
  }
  async function toggleTill() {
    if (!till.exists) return;
    setBusy(true);
    try { const next = await clientApi<Till>(`/admin/stores/${storeId}/till`, { method: "PATCH", body: JSON.stringify({ status: till.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }) }); setTill(next); toast.success("Till status updated"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not update till status"); }
    finally { setBusy(false); }
  }

  return <div className="mb-5 grid gap-4 lg:grid-cols-2">
    <section className="grid gap-3 rounded-lg border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Shared till login</h2><p className="text-sm text-muted-foreground">The device login is shared; the named cashier is selected on each bill.</p></div>{till.exists && <StatusBadge status={till.status ?? "ACTIVE"} />}</div><p className="text-sm">Login ID: <code>{till.loginId}</code>{till.activeSessions ? ` · ${till.activeSessions} active session(s)` : ""}</p>{canManage && <><div className="grid gap-2 sm:grid-cols-2"><PasswordInput autoComplete="new-password" placeholder={till.exists ? "New till password (optional)" : "Till password (12+ characters)"} value={password} onChange={(event) => setPassword(event.target.value)} /><PasswordInput secret="PIN" inputMode="numeric" placeholder="Till PIN (optional)" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} /></div><div className="flex flex-wrap gap-2"><Button onClick={() => void saveTill()} disabled={busy}>{till.exists ? "Reset credentials" : "Create till login"}</Button>{till.exists && <><Button variant="outline" onClick={() => void signOutAllTills()} disabled={busy}>Sign out all tills</Button><Button variant="outline" onClick={() => void toggleTill()} disabled={busy}>{till.status === "ACTIVE" ? "Disable till" : "Enable till"}</Button></>}</div></>}</section>
    <section className="grid gap-3 rounded-lg border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Named cashiers</h2><p className="text-sm text-muted-foreground">These names are attributed to sales, holds, returns, and register activity.</p></div>{canManage && <Button size="sm" variant="outline" onClick={() => void importCashiers()} disabled={busy}>Import staff cashiers</Button>}</div><div className="grid gap-2 sm:grid-cols-[1fr_9rem_8rem_auto]"><Input placeholder="Cashier name" value={name} onChange={(event) => setName(event.target.value)} /><Input placeholder="Employee code" value={code} onChange={(event) => setCode(event.target.value)} /><PasswordInput secret="PIN" inputMode="numeric" placeholder="PIN (optional)" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} /><Button onClick={() => void addCashier()} disabled={!canManage || busy || !name.trim()}>Add</Button></div><div className="divide-y rounded-md border">{cashiers.map((cashier) => <div key={cashier.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"><div className="min-w-0 flex-1"><span className="font-medium">{cashier.displayName}</span>{cashier.employeeCode && <span className="ms-2 text-muted-foreground">{cashier.employeeCode}</span>}<span className="ms-2 text-xs text-muted-foreground">{cashier.hasPin ? "PIN protected" : "No PIN"}{cashier.lastSelectedAt ? ` · Last used ${new Date(cashier.lastSelectedAt).toLocaleString()}` : ""}</span></div><StatusBadge status={cashier.status} />{canManage && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(editing === cashier.id ? null : cashier.id); setName(cashier.displayName); setCode(cashier.employeeCode); }}>{editing === cashier.id ? "Close" : "Edit"}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void updateCashier(cashier, { status: cashier.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>{cashier.status === "ACTIVE" ? "Deactivate" : "Activate"}</Button>{cashier.hasPin && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void updateCashier(cashier, { pin: "" })}>Clear PIN</Button>}</>}</div>)}{cashiers.length === 0 && <p className="p-4 text-sm text-muted-foreground">No named cashiers yet.</p>}</div>{editing && <div className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_9rem_auto]"><Input value={name} onChange={(event) => setName(event.target.value)} /><Input value={code} onChange={(event) => setCode(event.target.value)} /><Button disabled={busy} onClick={() => { const row = cashiers.find((item) => item.id === editing); if (row) void updateCashier(row, { displayName: name, employeeCode: code }); }}>Save changes</Button></div>}</section>
  </div>;
}

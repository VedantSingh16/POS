"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { clientApi } from "@/features/client-api";
import { formatDateTime } from "@/lib/format";
import { useLocale } from "@/components/i18n/locale-provider";

type AttendanceRow = { id: string; userId: string; name: string; status: string; clockedInAt: string; clockedOutAt: string | null; clockedInBy: string; clockedOutBy: string | null; clockOutReason: string };
type Staff = { id: string; name: string };

export function AttendancePanel({ storeId, currentUserId, records, staff, canManage }: { storeId: string; currentUserId: string; records: AttendanceRow[]; staff: Staff[]; canManage: boolean }) {
  const router = useRouter();
  const { locale } = useLocale();
  const [busy, setBusy] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState("");
  const ownOpen = records.some((row) => row.userId === currentUserId && row.status === "OPEN");

  async function submit(path: string, body: Record<string, unknown>, message: string) {
    setBusy(true);
    try { await clientApi(path, { method: "POST", headers: { "x-store-id": storeId }, body: JSON.stringify(body) }); toast.success(message); router.refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Attendance action failed"); }
    finally { setBusy(false); }
  }

  function correctClockOut(row: AttendanceRow) {
    const reason = window.prompt(`Why are you correcting ${row.name}'s missed clock-out?`)?.trim();
    if (reason) void submit("/pos/v1/attendance/clock-out", { storeId, userId: row.userId, reason }, `${row.name} clocked out`);
  }

  return <div className="grid gap-4">
    <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><p className="font-medium"><LocalizedText value={"Your shift"} /></p><p className="text-sm text-muted-foreground"><LocalizedText value={"Clock in and out at this store. Managers can correct a missed clock-out with a reason."} /></p></div>
      {!ownOpen ? <Button disabled={busy} onClick={() => void submit("/pos/v1/attendance/clock-in", { storeId }, "Clocked in")}><LocalizedText value={"Clock in"} /></Button> : <Button variant="outline" disabled={busy} onClick={() => void submit("/pos/v1/attendance/clock-out", { storeId }, "Clocked out")}><LocalizedText value={"Clock out"} /></Button>}
    </CardContent></Card>
    {canManage && staff.length > 0 && <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
      <label className="grid min-w-56 flex-1 gap-1 text-sm"><LocalizedText value={"Clock in a staff member"} /><NativeSelect value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value=""><LocalizedText value={"Choose staff"} /></option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</NativeSelect></label>
      <Button disabled={busy || !selectedUser} onClick={() => void submit("/pos/v1/attendance/clock-in", { storeId, userId: selectedUser }, "Staff member clocked in")}><LocalizedText value={"Clock in staff"} /></Button>
    </CardContent></Card>}
    <Card><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-start text-sm"><thead className="border-b bg-secondary/40 text-xs text-muted-foreground"><tr><th className="px-4 py-3"><LocalizedText value={"Staff member"} /></th><th className="px-4 py-3"><LocalizedText value={"Clocked in"} /></th><th className="px-4 py-3"><LocalizedText value={"Clocked out"} /></th><th className="px-4 py-3"><LocalizedText value={"Status / action"} /></th></tr></thead><tbody className="divide-y">{records.map((row) => <tr key={row.id}><td className="px-4 py-3 font-medium">{row.name}<span className="block text-xs font-normal text-muted-foreground"><LocalizedText value={"In by "} />{row.clockedInBy}{row.clockOutReason ? ` · ${row.clockOutReason}` : ""}</span></td><td className="px-4 py-3">{formatDateTime(row.clockedInAt, locale)}</td><td className="px-4 py-3">{row.clockedOutAt ? formatDateTime(row.clockedOutAt, locale) : "—"}</td><td className="px-4 py-3">{row.status === "OPEN" && canManage && row.userId !== currentUserId ? <Button size="sm" variant="outline" disabled={busy} onClick={() => correctClockOut(row)}><LocalizedText value={"Correct clock-out"} /></Button> : row.status === "OPEN" ? <LocalizedText value={"On shift"} /> : <span className="text-muted-foreground"><LocalizedText value={"Closed"} />{row.clockedOutBy ? ` · by ${row.clockedOutBy}` : ""}</span>}</td></tr>)}{records.length === 0 && <tr><td className="px-4 py-8 text-center text-muted-foreground" colSpan={4}><LocalizedText value={"No attendance records for this store yet."} /></td></tr>}</tbody></table></div></CardContent></Card>
    <p className="text-xs text-muted-foreground"><LocalizedText value={"Open shifts stay visible if a clock-out is missed. Corrections keep the original staff member, manager, timestamp, and reason in the audit history."} /></p>
  </div>;
}

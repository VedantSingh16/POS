"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock, LogOut, User } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useMe } from "@/components/app/session-context";


export async function lockTill(router: ReturnType<typeof useRouter>) {
  const res = await fetch("/api/auth/lock", { method: "POST" });
  if (res.ok) router.replace("/lock");
  else toast.error((await res.json().catch(() => ({ message: "Could not lock" }))).message);
}

export function IdleLock({ onLock, lockSession = true }: { onLock?: () => void; lockSession?: boolean } = {}) {
  const me = useMe();
  const router = useRouter();
  const idleMinutes = me.idleLockMinutes ?? 15;
  React.useEffect(() => {
    if (!me.hasPin) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { onLock?.(); if (lockSession) void lockTill(router); }, idleMinutes * 60_000); };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, arm)); };
  }, [me.hasPin, idleMinutes, lockSession, onLock, router]);
  return null;
}

function SetPinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState("");
  const valid = /^\d{4,8}$/.test(pin);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/proxy/auth/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).message ?? "Could not save the PIN"); return; }
    setPin(""); setError(""); onOpenChange(false); toast.success("PIN saved"); router.refresh();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle><LocalizedText value={"Set till PIN"} /></DialogTitle>
        <DialogDescription><LocalizedText value={"4 to 8 digits. Used to unlock a shared till without signing in again."} /></DialogDescription>
        <form onSubmit={save} className="grid gap-3">
          <Input aria-label="PIN" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }} />
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><DialogClose asChild><Button type="button" variant="outline"><LocalizedText value={"Cancel"} /></Button></DialogClose><Button type="submit" disabled={!valid}><LocalizedText value={"Save PIN"} /></Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UserMenu({ onLock }: { onLock?: () => void } = {}) {
  const me = useMe();
  const router = useRouter();
  const isTill = me.user.accountType === "STORE_TILL";
  const [pinOpen, setPinOpen] = React.useState(false);
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="User menu"><User /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            <span className="block text-sm font-medium text-foreground">{me.user.displayName}</span>
            <span className="block">{[...new Set(me.roles.map((r) => r.name))].join(", ")}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {me.hasPin && <DropdownMenuItem onSelect={() => { onLock?.(); void lockTill(router); }}><Lock /> <LocalizedText value={"Lock till"} /></DropdownMenuItem>}
          {!isTill && <DropdownMenuItem onSelect={() => router.push("/account")}><User /> <LocalizedText value={"My account"} /></DropdownMenuItem>}
          {!isTill && <DropdownMenuItem onSelect={() => setPinOpen(true)}><KeyRound /> <LocalizedText value={me.hasPin ? "Change PIN" : "Set PIN"} /></DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> <LocalizedText value={"Sign out"} /></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SetPinDialog open={pinOpen} onOpenChange={setPinOpen} />
    </>
  );
}

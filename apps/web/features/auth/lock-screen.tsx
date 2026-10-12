"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Delete, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function LockScreen({ name, home }: { name: string; home: string }) {
  const router = useRouter();
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const press = (d: string) => { setError(""); setPin((p) => (p + d).slice(0, 8)); };

  async function unlock() {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    const res = await fetch("/api/auth/unlock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) }).catch(() => null);
    setBusy(false); setPin("");
    if (!res) { setError("Could not reach the server."); return; }
    if (res.status === 204) { router.replace(home); router.refresh(); return; }
    const body = await res.json().catch(() => ({}));
    if (body.sessionEnded) { router.replace("/login"); router.refresh(); return; }
    setError(body.message ?? "Could not unlock");
  }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") void unlock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="grid min-h-screen place-items-center bg-sidebar p-4"><Card className="w-full max-w-xs"><CardContent className="grid gap-4 p-6 text-center">
      <Lock className="mx-auto size-6 text-muted-foreground" />
      <div><h1 className="text-lg font-semibold">Till locked</h1><p className="text-sm text-muted-foreground">{name}, enter your PIN</p></div>
      <div role="status" aria-label={`${pin.length} digits entered`} className="flex min-h-3 justify-center gap-2">{Array.from({ length: Math.max(pin.length, 4) }, (_, i) => <span key={i} className={`size-3 rounded-full border ${i < pin.length ? "bg-primary" : ""}`} />)}</div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        {"123456789".split("").map((d) => <Button key={d} size="touch" variant="outline" onClick={() => press(d)}>{d}</Button>)}
        <Button size="touch" variant="ghost" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))}><Delete /></Button>
        <Button size="touch" variant="outline" onClick={() => press("0")}>0</Button>
        <Button size="touch" onClick={() => void unlock()} disabled={pin.length < 4 || busy}>Unlock</Button>
      </div>
      <button onClick={() => void signOut()} className="text-xs text-muted-foreground underline">Sign out instead</button>
    </CardContent></Card></div>
  );
}

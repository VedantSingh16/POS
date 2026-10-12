"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clientApi } from "@/features/client-api";

type Group = { group: string; codes: string[] };
type Effect = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export function PermissionMatrix({ groups, roleId, initialEffects, readOnly }: { groups: Group[]; roleId: string; initialEffects?: Record<string, Effect>; readOnly?: boolean }) {
  const [effects, setEffects] = React.useState<Record<string, Effect>>(() => Object.fromEntries(groups.flatMap((group) => group.codes).map((code) => [code, initialEffects?.[code] ?? "DENY"])));
  const [busy, setBusy] = React.useState(false);
  async function save() {
    setBusy(true);
    try {
      const permissions = Object.keys(effects);
      await clientApi(`/admin/roles/${roleId}`, { method: "PATCH", body: JSON.stringify({ permissions, permissionEffects: effects }) });
      toast.success("Permission matrix saved");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save permissions"); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-5"><div className="grid gap-4 md:grid-cols-2">{groups.map((group) => <fieldset key={group.group} disabled={readOnly} className="min-w-0"><legend className="mb-2 text-sm font-semibold">{group.group}</legend><ul className="grid gap-2">{group.codes.map((code) => <li key={code} className="grid grid-cols-[1fr_auto] items-center gap-2"><span className="font-mono text-xs">{code}</span><select className="h-9 rounded-md border bg-background px-2 text-xs" value={effects[code] ?? "DENY"} onChange={(event) => setEffects((current) => ({ ...current, [code]: event.target.value as Effect }))}><option value="ALLOW">Allow</option><option value="REQUIRE_APPROVAL">Requires approval</option><option value="DENY">No access</option></select></li>)}</ul></fieldset>)}</div>{!readOnly && <Button className="sm:w-fit" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save permissions"}</Button>}</div>;
}

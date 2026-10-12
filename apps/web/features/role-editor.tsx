"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { clientApi } from "@/features/client-api";

type PermissionGroup = { group: string; codes: string[] };
type Effect = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export function RoleEditor({ groups }: { groups: PermissionGroup[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [effects, setEffects] = React.useState<Record<string, Effect>>(() => Object.fromEntries(groups.flatMap((group) => group.codes).map((code) => [code, "DENY"])));
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) { setError("Enter a role name with at least 2 characters."); return; }
    setBusy(true);
    try {
      const permissions = Object.entries(effects).filter(([, effect]) => effect !== "DENY").map(([code]) => code);
      const role = await clientApi<{ id: string }>("/admin/roles", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim(), permissions, permissionEffects: effects }),
      });
      toast.success("Role created");
      router.replace(`/org/roles/${role.id}`);
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not create role";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5" noValidate>
      <Card>
        <CardHeader><CardTitle>Role details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Role name" htmlFor="role-name"><Input id="role-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></Field>
          <Field label="Description" htmlFor="role-description"><Textarea id="role-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} /></Field>
          <p className="text-sm text-muted-foreground sm:col-span-2">This defines what the role can do. Choose organisation or store scope when assigning it to a person.</p>
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group.group}>
          <CardHeader><CardTitle>{group.group}</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {group.codes.map((code) => (
                <li key={code} className="grid grid-cols-[minmax(0,1fr)_minmax(150px,220px)] items-center gap-3 border-b pb-3 last:border-0 last:pb-0">
                  <span className="font-mono text-xs sm:text-sm">{code}</span>
                  <NativeSelect aria-label={`Permission effect for ${code}`} value={effects[code] ?? "DENY"} onChange={(event) => setEffects((current) => ({ ...current, [code]: event.target.value as Effect }))}>
                    <option value="DENY">No access</option>
                    <option value="ALLOW">Allow</option>
                    <option value="REQUIRE_APPROVAL">Requires approval</option>
                  </NativeSelect>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create role"}</Button></div>
    </form>
  );
}

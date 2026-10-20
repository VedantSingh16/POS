"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { clientApi } from "@/features/client-api";
import { RoleElevationDialog, type RoleAssessment } from "@/features/roles/elevation-dialog";
import { assessRoleChange, PERMISSION_RISK, ROLE_TEMPLATES, type PermissionCode, type RiskLevel, type RoleTemplateKey } from "@pos/shared/permissions";

type PermissionGroup = { group: string; codes: string[] };
type Effect = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

const RISK_TONE: Record<RiskLevel, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

// A brand-new custom role is always distinct from the seeded Organisation Administrator: picking that
// template here would leave the new role's templateKey set to 'org_admin', which the API then refuses to
// ever edit again (see admin.service.ts updateRole). So it is deliberately not offered as a starting point.
const STARTING_TEMPLATES = Object.values(ROLE_TEMPLATES).filter((template) => template.key !== "org_admin");

export function RoleEditor({ groups }: { groups: PermissionGroup[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [templateKey, setTemplateKey] = React.useState<RoleTemplateKey | "">("");
  const [storeAssignable, setStoreAssignable] = React.useState(false);
  const [effects, setEffects] = React.useState<Record<string, Effect>>(() => Object.fromEntries(groups.flatMap((group) => group.codes).map((code) => [code, "DENY"])));
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [dialog, setDialog] = React.useState<{ assessment: RoleAssessment; permissions: string[] } | null>(null);

  function applyTemplate(value: RoleTemplateKey | "") {
    setTemplateKey(value);
    const template = value ? ROLE_TEMPLATES[value] : undefined;
    const allowed = new Set(template?.permissions ?? []);
    setEffects(Object.fromEntries(groups.flatMap((group) => group.codes).map((code) => [code, allowed.has(code as PermissionCode) ? "ALLOW" : "DENY"])));
    setStoreAssignable(template?.storeAssignable ?? false);
  }

  async function persist(permissions: string[], extra: { acknowledgedPermissions?: string[]; reason?: string } = {}) {
    setBusy(true);
    try {
      const role = await clientApi<{ id: string }>("/admin/roles", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim(), permissions, permissionEffects: effects, storeAssignable, templateKey: templateKey || undefined, ...extra }),
      });
      toast.success("Role created");
      setDialog(null);
      router.replace(`/org/roles/${role.id}`);
      router.refresh();
    } catch (cause) {
      const payload = (cause as { payload?: { code?: string; assessment?: RoleAssessment } } | undefined)?.payload;
      if (payload?.code === "ROLE_ELEVATION_CONFIRMATION_REQUIRED" && payload.assessment) {
        setDialog({ assessment: payload.assessment, permissions });
        return;
      }
      const message = cause instanceof Error ? cause.message : "Could not create role";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) { setError("Enter a role name with at least 2 characters."); return; }
    const permissions = Object.entries(effects).filter(([, effect]) => effect !== "DENY").map(([code]) => code);
    const assessment = assessRoleChange({
      templateKey: templateKey || null,
      before: {},
      after: effects as Partial<Record<PermissionCode, Effect>>,
      storeAssignable,
    });
    if (assessment.blocked.length > 0) { setError(assessment.blocked.join(" ")); return; }
    if (assessment.confirmLevel !== "NONE") { setDialog({ assessment, permissions }); return; }
    await persist(permissions);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5" noValidate>
      <Card>
        <CardHeader><CardTitle><LocalizedText value={"Role details"} /></CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Role name" htmlFor="role-name"><Input id="role-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></Field>
          <Field label="Description" htmlFor="role-description"><Textarea id="role-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} /></Field>
          <Field label="Based on" htmlFor="role-template" hint="Pre-fills the permissions below with that role's usual access. You can still change anything before saving.">
            <NativeSelect id="role-template" value={templateKey} onChange={(event) => applyTemplate(event.target.value as RoleTemplateKey | "")}>
              <option value=""><LocalizedText value={"Start blank"} /></option>
              {STARTING_TEMPLATES.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
            </NativeSelect>
          </Field>
          <p className="text-sm text-muted-foreground sm:col-span-2"><LocalizedText value={"This defines what the role can do. Choose organisation or store scope when assigning it to a person."} /></p>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={storeAssignable} onChange={(event) => setStoreAssignable(event.target.checked)} /><span><b><LocalizedText value={"Allow store managers to assign this role"} /></b><span className="mt-0.5 block text-xs text-muted-foreground"><LocalizedText value={"Managers can assign it only within their store and only when its permissions fit their own access."} /></span></span></label>
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group.group}>
          <CardHeader><CardTitle>{group.group}</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {group.codes.map((code) => {
                const risk = PERMISSION_RISK[code as PermissionCode] as { level: RiskLevel; reason: string } | undefined;
                return (
                  <li key={code} className="grid grid-cols-[minmax(0,1fr)_minmax(150px,220px)] items-center gap-3 border-b pb-3 last:border-0 last:pb-0">
                    <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs sm:text-sm">
                      {code}
                      {risk && risk.level !== "LOW" && <Badge tone={RISK_TONE[risk.level]} className="px-1.5 py-0 text-[11px]">{risk.level}</Badge>}
                    </span>
                    <NativeSelect aria-label={`Permission effect for ${code}`} value={effects[code] ?? "DENY"} onChange={(event) => setEffects((current) => ({ ...current, [code]: event.target.value as Effect }))}>
                      <option value="DENY"><LocalizedText value={"No access"} /></option>
                      <option value="ALLOW"><LocalizedText value={"Allow"} /></option>
                      <option value="REQUIRE_APPROVAL"><LocalizedText value={"Requires approval"} /></option>
                    </NativeSelect>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ))}

      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex justify-end"><Button type="submit" disabled={busy}><LocalizedText value={busy ? "Creating…" : "Create role"} /></Button></div>

      <RoleElevationDialog
        open={dialog !== null}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        roleName={name.trim() || "this role"}
        assessment={dialog?.assessment ?? null}
        busy={busy}
        onConfirm={({ reason, acknowledgedPermissions }) => {
          if (!dialog) return;
          void persist(dialog.permissions, { acknowledgedPermissions, reason });
        }}
      />
    </form>
  );
}

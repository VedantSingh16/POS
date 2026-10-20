"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { clientApi } from "@/features/client-api";
import { RoleElevationDialog, type RoleAssessment } from "@/features/roles/elevation-dialog";
import { assessRoleChange, PERMISSION_RISK, type PermissionCode, type RiskLevel } from "@pos/shared/permissions";

type Group = { group: string; codes: string[] };
type Effect = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

const RISK_TONE: Record<RiskLevel, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

const EFFECT_LABEL: Record<Effect, string> = { ALLOW: "Allow", REQUIRE_APPROVAL: "Requires approval", DENY: "No access" };

export function PermissionMatrix({
  groups,
  roleId,
  roleName,
  initialEffects,
  readOnly,
  initialStoreAssignable = false,
  templateKey = null,
  defaultPermissionEffects = {},
  customized = false,
  templateUpdateAvailable = false,
}: {
  groups: Group[];
  roleId: string;
  roleName: string;
  initialEffects?: Record<string, Effect>;
  readOnly?: boolean;
  initialStoreAssignable?: boolean;
  templateKey?: string | null;
  defaultPermissionEffects?: Record<string, Effect>;
  customized?: boolean;
  templateUpdateAvailable?: boolean;
}) {
  const router = useRouter();
  const [effects, setEffects] = React.useState<Record<string, Effect>>(() => Object.fromEntries(groups.flatMap((group) => group.codes).map((code) => [code, initialEffects?.[code] ?? "DENY"])));
  const [storeAssignable, setStoreAssignable] = React.useState(initialStoreAssignable);
  const [busy, setBusy] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [dialog, setDialog] = React.useState<{ assessment: RoleAssessment; permissions: string[] } | null>(null);
  const baseline = React.useMemo(() => initialEffects ?? {}, [initialEffects]);

  async function persist(permissions: string[], extra: { acknowledgedPermissions?: string[]; reason?: string } = {}) {
    setBusy(true);
    try {
      await clientApi(`/admin/roles/${roleId}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions, permissionEffects: effects, storeAssignable, ...extra }),
      });
      toast.success("Permission matrix saved");
      setDialog(null);
      router.refresh();
    } catch (error) {
      const payload = (error as { payload?: { code?: string; assessment?: RoleAssessment } } | undefined)?.payload;
      if (payload?.code === "ROLE_ELEVATION_CONFIRMATION_REQUIRED" && payload.assessment) {
        setDialog({ assessment: payload.assessment, permissions });
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not save permissions");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const permissions = Object.keys(effects);
    const assessment = assessRoleChange({
      templateKey,
      before: baseline as Partial<Record<PermissionCode, Effect>>,
      after: effects as Partial<Record<PermissionCode, Effect>>,
      storeAssignable,
    });
    if (assessment.blocked.length > 0) {
      toast.error(assessment.blocked.join(" "));
      return;
    }
    if (assessment.confirmLevel === "NONE") {
      await persist(permissions);
      return;
    }
    setDialog({ assessment, permissions });
  }

  async function resetToDefault() {
    setResetting(true);
    try {
      await clientApi(`/admin/roles/${roleId}/reset`, { method: "POST" });
      toast.success("Role reset to its default permissions");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset this role");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="grid gap-5">
      {templateKey && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
          <span className="flex items-center gap-2">
            {customized ? <Badge tone="warning"><LocalizedText value={"Modified from default"} /></Badge> : <Badge tone="brand"><LocalizedText value={"Follows default"} /></Badge>}
            {templateUpdateAvailable && <span className="text-xs text-muted-foreground"><LocalizedText value={"A newer default is available for this role."} /></span>}
          </span>
          {!readOnly && customized && (
            <Button size="sm" variant="outline" disabled={resetting} onClick={() => void resetToDefault()}>
              <LocalizedText value={resetting ? "Resetting…" : "Reset to default"} />
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <fieldset key={group.group} disabled={readOnly} className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">{group.group}</legend>
            <ul className="grid gap-2">
              {group.codes.map((code) => {
                const risk = PERMISSION_RISK[code as PermissionCode] as { level: RiskLevel; reason: string } | undefined;
                const defaultEffect = defaultPermissionEffects[code];
                return (
                  <li key={code} className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs">{code}</span>
                        {risk && risk.level !== "LOW" && (
                          <Badge tone={RISK_TONE[risk.level]} className="px-1.5 py-0 text-[11px]">{risk.level}</Badge>
                        )}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        <LocalizedText value={`Default: ${EFFECT_LABEL[defaultEffect ?? "DENY"]}`} />
                      </span>
                    </span>
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-xs"
                      value={effects[code] ?? "DENY"}
                      onChange={(event) => setEffects((current) => ({ ...current, [code]: event.target.value as Effect }))}
                    >
                      <option value="ALLOW"><LocalizedText value={"Allow"} /></option>
                      <option value="REQUIRE_APPROVAL"><LocalizedText value={"Requires approval"} /></option>
                      <option value="DENY"><LocalizedText value={"No access"} /></option>
                    </select>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>

      {!readOnly && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={storeAssignable} onChange={(event) => setStoreAssignable(event.target.checked)} />
          <span>
            <b><LocalizedText value={"Allow store managers to assign this role"} /></b>
            <span className="mt-0.5 block text-xs text-muted-foreground"><LocalizedText value={"The manager must have every allowed permission in the target store."} /></span>
          </span>
        </label>
      )}
      {!readOnly && (
        <Button className="sm:w-fit" onClick={() => void save()} disabled={busy}>
          <LocalizedText value={busy ? "Saving…" : "Save role"} />
        </Button>
      )}

      <RoleElevationDialog
        open={dialog !== null}
        onOpenChange={(open) => { if (!open) setDialog(null); }}
        roleName={roleName}
        assessment={dialog?.assessment ?? null}
        busy={busy}
        onConfirm={({ reason, acknowledgedPermissions }) => {
          if (!dialog) return;
          void persist(dialog.permissions, { acknowledgedPermissions, reason });
        }}
      />
    </div>
  );
}

"use client";
import { LocalizedText } from "@/components/i18n/localized-text";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import type { RoleChangeAssessment, RiskLevel } from "@pos/shared/permissions";

const RISK_TONE: Record<RiskLevel, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export type RoleAssessment = RoleChangeAssessment & { assignedUserCount?: number; assignedStoreCount?: number };

/** Review-before-save warning shown whenever a role change goes above its safe (template) level. The
 * server runs the exact same assessment (packages/shared/src/permissions.ts assessRoleChange), so this
 * dialog never shows a warning the API would not also enforce on save. */
export function RoleElevationDialog({ open, onOpenChange, roleName, assessment, busy, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleName: string;
  assessment: RoleAssessment | null;
  busy?: boolean;
  onConfirm: (input: { reason: string; acknowledgedPermissions: string[] }) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [typedName, setTypedName] = React.useState("");

  React.useEffect(() => {
    if (open) { setReason(""); setTypedName(""); }
  }, [open]);

  if (!assessment) return null;
  const flagged = dedupe([...assessment.elevated, ...assessment.newlyHighRisk]);
  const needsTypeToConfirm = assessment.confirmLevel === "TYPE_TO_CONFIRM";
  const nameMatches = typedName.trim().toLowerCase() === roleName.trim().toLowerCase();
  const reasonOk = !assessment.requiresReason || reason.trim().length >= 10;
  const canConfirm = reasonOk && (!needsTypeToConfirm || nameMatches) && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle><LocalizedText value={"Review elevated access"} /></DialogTitle>
        <DialogDescription>
          <LocalizedText value={"This change grants access above what this role normally has. Review it before saving."} />
        </DialogDescription>

        {(assessment.assignedUserCount ?? 0) > 0 && (
          <p className="rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm">
            <LocalizedText value={"Applies immediately to "} />
            <b>{assessment.assignedUserCount} {assessment.assignedUserCount === 1 ? "person" : "people"}</b>
            {(assessment.assignedStoreCount ?? 0) > 0 && (
              <> <LocalizedText value={"in "} /><b>{assessment.assignedStoreCount} {assessment.assignedStoreCount === 1 ? "store" : "stores"}</b></>
            )}
            .
          </p>
        )}

        {flagged.length > 0 && (
          <ul className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3">
            {flagged.map((flag) => (
              <li key={flag.code} className="grid grid-cols-[auto_1fr] items-start gap-2 text-sm">
                <Badge tone={RISK_TONE[flag.level]}><LocalizedText value={RISK_LABEL[flag.level]} /></Badge>
                <span>
                  <span className="font-mono text-xs">{flag.code}</span>
                  <span className="block text-xs text-muted-foreground">{flag.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {assessment.conflicts.length > 0 && (
          <div className="grid gap-1 rounded-md border border-danger bg-danger-soft p-3 text-sm">
            {assessment.conflicts.map((conflict, index) => (
              <p key={index}>{conflict.message}</p>
            ))}
          </div>
        )}

        {assessment.ineffective.length > 0 && (
          <div className="grid gap-1 rounded-md border p-3 text-xs text-muted-foreground">
            {assessment.ineffective.map((item) => (
              <p key={item.code}><span className="font-mono">{item.code}</span>: {item.message}</p>
            ))}
          </div>
        )}

        {assessment.storeAssignabilityLost && (
          <p className="text-xs text-muted-foreground"><LocalizedText value={"Store managers may no longer be able to assign this role, if their own access doesn’t cover the new permissions."} /></p>
        )}

        {assessment.requiresReason && (
          <label className="grid gap-1 text-sm">
            <span className="font-medium"><LocalizedText value={"Reason for this change"} /></span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} placeholder="Why does this role need this access?" />
          </label>
        )}

        {needsTypeToConfirm && (
          <label className="grid gap-1 text-sm">
            <span className="font-medium"><LocalizedText value={"Type the role name to confirm"} /> (<span className="font-mono">{roleName}</span>)</span>
            <Input value={typedName} onChange={(event) => setTypedName(event.target.value)} autoComplete="off" />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button variant="outline"><LocalizedText value={"Go back"} /></Button></DialogClose>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={() => onConfirm({ reason: reason.trim(), acknowledgedPermissions: flagged.map((flag) => flag.code) })}
          >
            <LocalizedText value={busy ? "Saving…" : "Grant elevated access"} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function dedupe<T extends { code: string }>(flags: T[]): T[] {
  const seen = new Map<string, T>();
  for (const flag of flags) if (!seen.has(flag.code)) seen.set(flag.code, flag);
  return [...seen.values()];
}

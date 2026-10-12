import { AlertTriangle, Inbox, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({ minor, className }: { minor: number; className?: string }) {
  return <span className={cn("tabular font-medium", minor < 0 && "text-danger", className)}>{formatMoney(minor)}</span>;
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";
const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success", OPEN: "success", COMPLETED: "success", APPROVED: "success", OK: "success",
  PENDING: "warning", LOW: "warning", PARTIALLY_RETURNED: "warning", SUSPENDED: "warning",
  VOIDED: "danger", OUT: "danger", REJECTED: "danger",
  INACTIVE: "neutral", CLOSED: "neutral",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function KpiTile({ label, value, hint, icon: Icon, tone = "neutral" }: { label: string; value: React.ReactNode; hint?: string; icon?: LucideIcon; tone?: Tone }) {
  return (
    <Card className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("tabular mt-1 truncate text-2xl font-semibold tracking-tight", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-muted-foreground")} aria-hidden />
      )}
    </Card>
  );
}

export function EmptyState({ title, description, icon: Icon = Inbox, action }: { title: string; description?: string; icon?: LucideIcon; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground"><Icon className="size-5" /></span>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-danger-soft text-danger"><AlertTriangle className="size-5" /></span>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-2 h-9 rounded-md border bg-card px-3.5 text-sm font-medium hover:bg-accent">Try again</button>
      )}
    </div>
  );
}

import { LocalizedText } from "@/components/i18n/localized-text";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Inbox, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Money lives in its own "use client" file (./money.tsx) because it calls the
 * useLocale() hook. This file renders fine as a Server Component as long as
 * none of its own exports call a hook directly; re-exporting Money keeps the
 * existing `from "@/components/data/primitives"` imports working unchanged.
 */
export { Money } from "@/components/data/money";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";
const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success", OPEN: "success", COMPLETED: "success", APPROVED: "success", OK: "success",
  PENDING: "warning", LOW: "warning", PARTIALLY_RETURNED: "warning", SUSPENDED: "warning",
  VOIDED: "danger", OUT: "danger", REJECTED: "danger",
  INACTIVE: "neutral", CLOSED: "neutral",
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}><LocalizedText value={status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} /></Badge>;
}

export function KpiTile({ label, value, hint, icon: Icon, tone = "neutral", href, linkLabel }: { label: string; value: React.ReactNode; hint?: string; icon?: LucideIcon; tone?: Tone; href?: string; linkLabel?: string }) {
  const content = <KpiTileContent label={label} value={value} hint={hint} icon={Icon} tone={tone} linkLabel={href ? linkLabel : undefined} />;
  const frame = "flex min-h-[5.25rem] items-start gap-3 border-s-0 px-2 py-2 sm:border-s sm:border-border sm:ps-4 sm:pe-3 sm:first:border-s-0 sm:first:ps-3";
  if (href) return <Link href={href} className={cn(frame, "group rounded-lg transition-colors hover:bg-muted/60 focus-visible:bg-muted/60")}>{content}</Link>;
  return <div className={frame}>{content}</div>;
}

function KpiTileContent({ label, value, hint, icon: Icon, tone, linkLabel }: { label: string; value: React.ReactNode; hint?: string; icon?: LucideIcon; tone: Tone; linkLabel?: string }) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-normal text-muted-foreground"><LocalizedText value={label} /></p>
        <p className={cn("tabular mt-1 truncate text-[2rem] font-bold tracking-tight", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</p>
        {hint && <p className="mt-1 text-sm text-muted-foreground"><LocalizedText value={hint} /></p>}
        {linkLabel && <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:underline"><LocalizedText value={linkLabel} /><ArrowRight aria-hidden className="size-3.5 rtl:rotate-180" /></p>}
      </div>
      {Icon && (
        <span className="mt-0.5 hidden shrink-0 rounded-md bg-muted/60 p-1.5 sm:block">
          <Icon className={cn("size-4", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-muted-foreground")} aria-hidden />
        </span>
      )}
    </>
  );
}

export function EmptyState({ title, description, icon: Icon = Inbox, action }: { title: string; description?: string; icon?: LucideIcon; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><Icon className="size-5" /></span>
      <p className="text-base font-semibold"><LocalizedText value={title} /></p>
      {description && <p className="max-w-sm text-sm text-muted-foreground"><LocalizedText value={description} /></p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-danger-soft text-danger"><AlertTriangle className="size-5" /></span>
      <p className="font-medium"><LocalizedText value={title} /></p>
      {description && <p className="max-w-sm text-sm text-muted-foreground"><LocalizedText value={description} /></p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-2 h-11 rounded-md border bg-card px-4 text-base font-medium hover:bg-accent"><LocalizedText value={"Try again"} /></button>
      )}
    </div>
  );
}

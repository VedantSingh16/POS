"use client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/locale-provider";

/**
 * Renders a minor-unit amount in the organisation's currency and locale.
 * Needs "use client": it reads the locale from React context via useLocale(),
 * and a component that calls a hook must run on the client. This component
 * is imported into many server-rendered pages (store overview, reports,
 * product/customer/sale detail) as ordinary JSX; without this directive the
 * hook call throws during server rendering and the whole page fails with
 * "This page failed to load".
 */
export function Money({ minor, className }: { minor: number; className?: string }) {
  const { locale } = useLocale();
  return <span className={cn("tabular font-medium", minor < 0 && "text-danger", className)}>{formatMoney(minor, locale)}</span>;
}

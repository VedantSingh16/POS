"use client";

import * as React from "react";
import { timeAgo } from "@/lib/format";
import { useLocale } from "@/components/i18n/locale-provider";

function stableLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export function RelativeTime({ value }: { value: string }) {
  const { locale } = useLocale();
  const label = React.useSyncExternalStore(
    (onStoreChange) => {
      const timer = window.setInterval(onStoreChange, 60_000);
      return () => window.clearInterval(timer);
    },
    () => timeAgo(value, locale),
    () => stableLabel(value),
  );
  return <time dateTime={value} title={value}>{label}</time>;
}

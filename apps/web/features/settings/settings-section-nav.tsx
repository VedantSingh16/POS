"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LocalizedText, useTranslate } from "@/components/i18n/localized-text";

export type SettingsSectionLink = { label: string; href: string };

/** Responsive secondary navigation for settings pages. */
export function SettingsSectionNav({ items }: { items: SettingsSectionLink[] }) {
  const pathname = usePathname();
  const t = useTranslate();

  return (
    <nav aria-label={t("Settings sections")} className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:self-start lg:overflow-visible lg:rounded-xl lg:border lg:border-border lg:bg-card lg:p-2 lg:pb-2">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-12 shrink-0 items-center rounded-xl border-s-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
              active && "border-s-primary bg-accent font-semibold text-accent-foreground",
            )}
          >
            <LocalizedText value={item.label} />
          </Link>
        );
      })}
    </nav>
  );
}

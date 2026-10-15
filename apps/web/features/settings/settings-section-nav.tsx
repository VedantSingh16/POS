"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SettingsSectionLink = { label: string; href: string };

/** Responsive secondary navigation for settings pages. */
export function SettingsSectionNav({ items }: { items: SettingsSectionLink[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:rounded-xl lg:border lg:border-border lg:bg-card lg:p-2 lg:pb-2">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-lg border-l-2 border-transparent px-3.5 py-2.5 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground",
              active && "border-l-primary bg-accent font-semibold text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

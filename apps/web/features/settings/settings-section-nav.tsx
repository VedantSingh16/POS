"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SettingsSectionLink = { label: string; href: string };

/** Responsive secondary navigation for settings pages. */
export function SettingsSectionNav({ items }: { items: SettingsSectionLink[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-sm border-l-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground lg:rounded-r-sm",
              active && "border-l-primary bg-accent/70 font-semibold text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

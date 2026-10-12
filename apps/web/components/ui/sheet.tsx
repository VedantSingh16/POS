"use client";
import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;
export const SheetTitle = ({ className, ...p }: React.ComponentProps<typeof D.Title>) => <D.Title className={cn("text-base font-semibold", className)} {...p} />;
export const SheetDescription = ({ className, ...p }: React.ComponentProps<typeof D.Description>) => <D.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;

const SIZES = { md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" } as const;

/** Tall content scrolls inside the panel (overflow-y-auto) so long forms stay reachable on any screen height. */
export function SheetContent({ className, side = "right", size = "md", children, ...props }: React.ComponentProps<typeof D.Content> & { side?: "right" | "left"; size?: keyof typeof SIZES }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <D.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-full flex-col gap-4 overflow-y-auto overscroll-contain bg-popover p-5 shadow-lg",
          side === "right" ? `right-0 border-l ${SIZES[size]}` : "left-0 max-w-72 border-r p-0",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close aria-label="Close" className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

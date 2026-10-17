"use client";
import * as React from "react";
import { Slot } from "radix-ui";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/components/i18n/localized-text";
import { buttonVariants } from "@/components/ui/button-variants";

/**
 * "use client" is required here: Button calls useTranslate(), a hook, in its
 * own render. Many server-rendered pages render <Button>…</Button> as plain
 * JSX (e.g. the store reports filter form); without this directive React
 * tries to run Button as a Server Component, the hook call throws, and the
 * whole page fails to load. buttonVariants (no hooks) stays importable by
 * server components from the separate button-variants.ts module.
 */

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const t = useTranslate();
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props}
    aria-label={typeof props["aria-label"] === "string" ? t(props["aria-label"]) : props["aria-label"]}
    title={typeof props.title === "string" ? t(props.title) : props.title}
  />;
}

export { Button };

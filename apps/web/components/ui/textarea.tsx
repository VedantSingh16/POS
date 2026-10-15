"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/components/i18n/localized-text";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => {
  const t = useTranslate();
  return <textarea ref={ref} className={cn("min-h-24 w-full rounded-md border bg-background px-3 py-2 text-base outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} placeholder={typeof props.placeholder === "string" ? t(props.placeholder) : props.placeholder} aria-label={typeof props["aria-label"] === "string" ? t(props["aria-label"]) : props["aria-label"]} title={typeof props.title === "string" ? t(props.title) : props.title} />;
});
Textarea.displayName = "Textarea";

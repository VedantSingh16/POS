import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3.5 text-base placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
        className,
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn("min-h-24 w-full rounded-lg border border-input bg-card px-3.5 py-3 text-base placeholder:text-muted-foreground aria-invalid:border-danger", className)}
      {...props}
    />
  );
}

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn("h-11 w-full rounded-lg border border-input bg-card px-3.5 text-base disabled:opacity-50 aria-invalid:border-danger", className)}
      {...props}
    />
  );
}

export { Input, Textarea, NativeSelect };

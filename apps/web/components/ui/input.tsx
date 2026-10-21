"use client";
import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslate } from "@/components/i18n/localized-text";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  const t = useTranslate();
  return (
    <input
      type={type}
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3.5 text-base placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20",
        className,
      )}
      {...props}
      placeholder={typeof props.placeholder === "string" ? t(props.placeholder) : props.placeholder}
      aria-label={typeof props["aria-label"] === "string" ? t(props["aria-label"]) : props["aria-label"]}
      title={typeof props.title === "string" ? t(props.title) : props.title}
    />
  );
}

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type"> & {
  /** Changes the toggle's accessible name: "Show PIN" instead of "Show password". */
  secret?: "password" | "PIN";
  wrapperClassName?: string;
  toggleClassName?: string;
};

/** A password or PIN field with an eye button to show or hide what was typed. Use it for every secret on the platform. */
function PasswordInput({ className, wrapperClassName, toggleClassName, secret = "password", ...props }: PasswordInputProps) {
  const t = useTranslate();
  const [visible, setVisible] = React.useState(false);
  const label = visible ? (secret === "PIN" ? "Hide PIN" : "Hide password") : (secret === "PIN" ? "Show PIN" : "Show password");
  return (
    <div className={cn("relative w-full min-w-0", props.hidden && "hidden", wrapperClassName)}>
      <Input {...props} type={visible ? "text" : "password"} className={cn(className, "pe-12")} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={t(label)}
        title={t(label)}
        aria-pressed={visible}
        disabled={props.disabled}
        className={cn("absolute end-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50", toggleClassName)}
      >
        {visible ? <EyeOff aria-hidden="true" className="size-[18px]" /> : <Eye aria-hidden="true" className="size-[18px]" />}
      </button>
    </div>
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const t = useTranslate();
  return (
    <textarea
      className={cn("min-h-24 w-full rounded-lg border border-input bg-card px-3.5 py-3 text-base placeholder:text-muted-foreground aria-invalid:border-danger", className)}
      {...props}
      placeholder={typeof props.placeholder === "string" ? t(props.placeholder) : props.placeholder}
      aria-label={typeof props["aria-label"] === "string" ? t(props["aria-label"]) : props["aria-label"]}
      title={typeof props.title === "string" ? t(props.title) : props.title}
    />
  );
}

function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  const t = useTranslate();
  return (
    <select
      className={cn("h-11 w-full rounded-lg border border-input bg-card px-3.5 text-base disabled:opacity-50 aria-invalid:border-danger", className)}
      {...props}
      aria-label={typeof props["aria-label"] === "string" ? t(props["aria-label"]) : props["aria-label"]}
      title={typeof props.title === "string" ? t(props.title) : props.title}
    />
  );
}

export { Input, PasswordInput, Textarea, NativeSelect };

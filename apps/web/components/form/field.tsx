import * as React from "react";
import { Label } from "@/components/ui/label";
import { LocalizedText } from "@/components/i18n/localized-text";

export function Field({ label, error, hint, htmlFor, children, translate = true }: { label: string; error?: string; hint?: string; htmlFor: string; children: React.ReactNode; translate?: boolean }) {
  const copy = (value: string) => translate ? <LocalizedText value={value} /> : value;
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={htmlFor}>{copy(label)}</Label>
      {children}
      {hint && !error && <p className="text-sm text-muted-foreground">{copy(hint)}</p>}
      {error && <p role="alert" className="text-sm text-danger">{copy(error)}</p>}
    </div>
  );
}

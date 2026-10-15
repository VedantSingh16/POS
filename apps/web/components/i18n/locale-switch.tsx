"use client";

import { useLocale } from "@/components/i18n/locale-provider";
import { useTranslate } from "@/components/i18n/localized-text";
import type { Locale } from "@/lib/i18n/messages";

export function LocaleSwitch({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const t = useTranslate();
  const options: { locale: Locale; label: string }[] = [
    { locale: "en", label: compact ? "EN" : "English" },
    { locale: "ar", label: compact ? "عربي" : "العربية" },
  ];

  return (
    <div role="group" aria-label={t("Choose language")} className={`inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 ${className}`}>
      {options.map((option) => (
        <button
          key={option.locale}
          type="button"
          lang={option.locale}
          aria-pressed={locale === option.locale}
          onClick={() => void setLocale(option.locale)}
          className={`min-h-8 rounded-md px-2.5 text-sm transition-colors ${locale === option.locale ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

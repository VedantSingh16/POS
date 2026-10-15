"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { translateText } from "@/lib/i18n/messages";

/** Render a source-language UI string in the active locale without adding an element to the DOM. */
export function LocalizedText({ value, children }: { value?: string; children?: ReactNode }) {
  const { locale } = useLocale();
  const source = value ?? (typeof children === "string" ? children : "");
  if (!source) return children;
  return translateText(source, locale);
}

/** Translate a UI label at a prop boundary (placeholders, headings, and similar). */
export function useTranslate() {
  const { locale } = useLocale();
  return React.useCallback((value: string) => translateText(value, locale), [locale]);
}

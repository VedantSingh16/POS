"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { translateText, type Locale } from "@/lib/i18n/messages";

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => Promise<void> };
const LocaleContext = React.createContext<LocaleContextValue | null>(null);

function applyDocumentLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
}

export function useLocale() {
  const context = React.useContext(LocaleContext);
  if (!context) throw new Error("LocaleProvider is missing");
  return context;
}

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, setCurrentLocale] = React.useState(initialLocale);
  const router = useRouter();
  const pathname = usePathname();
  const originalTitle = React.useRef("");
  const localizedTitle = React.useRef("");

  React.useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  React.useEffect(() => {
    const syncTitle = () => {
      const currentTitle = document.title;
      if (currentTitle && currentTitle !== localizedTitle.current) originalTitle.current = currentTitle;
      const sourceTitle = originalTitle.current || currentTitle;
      const nextTitle = locale === "ar"
        ? sourceTitle.split(" · ").map((part) => translateText(part, locale)).join(" · ")
        : sourceTitle;
      if (nextTitle !== currentTitle) {
        localizedTitle.current = nextTitle;
        document.title = nextTitle;
      } else {
        localizedTitle.current = currentTitle;
      }
    };
    syncTitle();
    const title = document.querySelector("title");
    if (!title) return;
    const observer = new MutationObserver(syncTitle);
    observer.observe(title, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [locale, pathname]);

  const setLocale = React.useCallback(async (nextLocale: Locale) => {
    if (nextLocale === locale) return;
    setCurrentLocale(nextLocale);
    applyDocumentLocale(nextLocale);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) throw new Error("Could not save language preference");
      router.refresh();
    } catch {
      setCurrentLocale(locale);
      applyDocumentLocale(locale);
    }
  }, [locale, router]);

  const value = React.useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

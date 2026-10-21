import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { getServerLocale } from "@/lib/i18n/server";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/manrope-latin-variable.woff2",
  variable: "--font-manrope",
  weight: "200 800",
  display: "swap",
});

/** Light is the default. Dark mode applies only after someone explicitly picks it with the theme toggle; the
 * operating-system colour preference is deliberately ignored. The key was renamed from "pos-theme" so every
 * browser starts again from light once. Keep the key in sync with ThemeToggle in components/app/app-shell.tsx. */
const THEME_STORAGE_KEY = "liqaa-theme";
const THEME_SCRIPT = `try{localStorage.removeItem("pos-theme");if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export const metadata: Metadata = {
  title: { default: "Liqaa POS", template: "%s · Liqaa POS" },
  description: "Retail point of sale: organisation administration, store operations and checkout",
  applicationName: "Liqaa POS",
};

export const viewport: Viewport = {
  themeColor: "#111b33",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getServerLocale();
  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      suppressHydrationWarning
      className={`${GeistMono.variable} ${manrope.variable} h-full antialiased`}
    >
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-full flex flex-col">
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
        <Toaster position={locale === "ar" ? "bottom-left" : "bottom-right"} richColors closeButton />
      </body>
    </html>
  );
}

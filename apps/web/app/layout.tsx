import type { Metadata } from "next";
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

const THEME_SCRIPT = `try{var t=localStorage.getItem("pos-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export const metadata: Metadata = {
  title: { default: "DeltPOS", template: "%s · DeltPOS" },
  description: "Retail point of sale: organisation administration, store operations and checkout",
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

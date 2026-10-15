import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { getServerLocale } from "@/lib/i18n/server";
import "./globals.css";

const THEME_SCRIPT = `try{var t=localStorage.getItem("pos-theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export const metadata: Metadata = {
  title: { default: "DeltCRM POS", template: "%s · DeltCRM POS" },
  description: "Retail point of sale: organisation administration, store operations and checkout",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getServerLocale();
  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="min-h-full flex flex-col">
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
        <Toaster position={locale === "ar" ? "bottom-left" : "bottom-right"} richColors closeButton />
      </body>
    </html>
  );
}

import { cookies } from "next/headers";
import { isLocale, translateText, type Locale } from "@/lib/i18n/messages";

export async function getServerLocale(): Promise<Locale> {
  const value = (await cookies()).get("pos_locale")?.value;
  return isLocale(value) ? value : "en";
}

export async function getLocalizedPageTitle(title: string): Promise<string> {
  return translateText(title, await getServerLocale());
}

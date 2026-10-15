import { formatDistanceToNowStrict } from "date-fns";
import { currencyInfo, DEFAULT_CURRENCY, formatMinor, isCurrencyCode, minorFactor, minorToInput, parseMinor } from "@pos/shared/currency";
import type { Locale } from "@pos/shared/locale";

const formatLocale = (locale: Locale) => locale === "ar" ? "ar" : "en-IN";

/**
 * The organisation's currency. It is set from the signed-in profile (on the server when the profile is read, and in the
 * browser by the session provider) before any money is drawn. One organisation per deployment is the normal case.
 */
let activeCurrency = DEFAULT_CURRENCY;
export function setActiveCurrency(code: string | null | undefined): void {
  activeCurrency = isCurrencyCode(code) ? code : DEFAULT_CURRENCY;
}
/** ISO code such as OMR or INR. Use it in labels: "Amount (OMR)". */
export const currencyCode = (): string => activeCurrency;
export const currencyDecimals = (): number => currencyInfo(activeCurrency).decimals;
/** Note values in major units for counting a cash drawer. */
export const currencyNotes = (): number[] => currencyInfo(activeCurrency).notes;
/** How many minor units (baisa, paise...) make one whole unit. */
export const minorPerUnit = (): number => minorFactor(activeCurrency);

/** Money is stored as integer minor units (baisa for OMR, paise for INR). */
export function formatMoney(minor: number, locale: Locale = "en"): string {
  const value = formatMinor(minor, activeCurrency);
  return locale === "ar" ? localizeDigits(value) : value;
}
/** What a person typed ("12.5") as minor units. NaN when it is not a number. */
export function toMinor(text: string | number): number {
  return parseMinor(text, activeCurrency);
}
/** Minor units as the plain number to show in an input box ("12.500"). */
export function toInput(minor: number): string {
  return minorToInput(minor, activeCurrency);
}
export function formatNumber(n: number, locale: Locale = "en"): string {
  return new Intl.NumberFormat(formatLocale(locale), {
    numberingSystem: locale === "ar" ? "arab" : "latn",
  }).format(n);
}
export function timeAgo(iso: string, locale: Locale = "en"): string {
  if (locale === "en") return `${formatDistanceToNowStrict(new Date(iso))} ago`;
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60], ["second", 1]];
  const [unit, duration] = units.find(([, size]) => Math.abs(seconds) >= size) ?? units[units.length - 1]!;
  return new Intl.RelativeTimeFormat("ar", { numeric: "always", style: "long" }).format(Math.round(seconds / duration), unit);
}
export function formatDateTime(value: string | Date, locale: Locale = "en", timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    numberingSystem: locale === "ar" ? "arab" : "latn",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatDate(value: string | Date, locale: Locale = "en", timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "medium",
    numberingSystem: locale === "ar" ? "arab" : "latn",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatTime(value: string | Date, locale: Locale = "en", timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(formatLocale(locale), {
    hour: "numeric",
    minute: "2-digit",
    numberingSystem: locale === "ar" ? "arab" : "latn",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

function localizeDigits(value: string): string {
  return value.replace(/[0-9]/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]!).replaceAll(",", "٬").replaceAll(".", "٫");
}

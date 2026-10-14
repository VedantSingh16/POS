import { formatDistanceToNowStrict, format } from "date-fns";
import { currencyInfo, DEFAULT_CURRENCY, formatMinor, isCurrencyCode, minorFactor, minorToInput, parseMinor } from "@pos/shared/currency";

const num = new Intl.NumberFormat("en-IN");

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
export function formatMoney(minor: number): string {
  return formatMinor(minor, activeCurrency);
}
/** What a person typed ("12.5") as minor units. NaN when it is not a number. */
export function toMinor(text: string | number): number {
  return parseMinor(text, activeCurrency);
}
/** Minor units as the plain number to show in an input box ("12.500"). */
export function toInput(minor: number): string {
  return minorToInput(minor, activeCurrency);
}
export function formatNumber(n: number): string {
  return num.format(n);
}
export function timeAgo(iso: string): string {
  return `${formatDistanceToNowStrict(new Date(iso))} ago`;
}
export function formatDateTime(iso: string): string {
  return format(new Date(iso), "dd MMM yyyy, HH:mm");
}

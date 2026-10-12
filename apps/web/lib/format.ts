import { formatDistanceToNowStrict, format } from "date-fns";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN");

/** Money is stored as integer minor units (paise). */
export function formatMoney(minor: number): string {
  return inr.format(minor / 100);
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

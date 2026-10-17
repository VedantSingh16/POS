/** Invoice sequence period in the store's own time zone. India uses April–March; other markets use a calendar year. */
export function financialYearLabel(date: Date, timeZone: string, countryCode = 'IN'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (countryCode !== 'IN') return String(year);
  const start = month >= 4 ? year : year - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

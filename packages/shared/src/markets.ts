/** Regions offered during setup. The country selects sensible currency and time-zone defaults. */
export type Market = { code: string; name: string; currency: string; timezone: string };

export const MARKETS: readonly Market[] = [
  { code: 'IN', name: 'India', currency: 'INR', timezone: 'Asia/Kolkata' },
  { code: 'OM', name: 'Oman', currency: 'OMR', timezone: 'Asia/Muscat' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', timezone: 'Asia/Riyadh' },
  { code: 'QA', name: 'Qatar', currency: 'QAR', timezone: 'Asia/Qatar' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', timezone: 'Asia/Kuwait' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD', timezone: 'Asia/Bahrain' },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London' },
  { code: 'DE', name: 'Germany', currency: 'EUR', timezone: 'Europe/Berlin' },
  { code: 'FR', name: 'France', currency: 'EUR', timezone: 'Europe/Paris' },
  { code: 'EU', name: 'Euro area', currency: 'EUR', timezone: 'UTC' },
  { code: 'ZZ', name: 'Other / choose currency', currency: 'INR', timezone: 'UTC' },
] as const;

export function marketByCode(code: unknown): Market | undefined {
  return typeof code === 'string' ? MARKETS.find((market) => market.code === code.toUpperCase()) : undefined;
}

export function isMarketCode(code: unknown): code is string {
  return Boolean(marketByCode(code));
}

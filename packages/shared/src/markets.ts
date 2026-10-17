/** Regions offered during setup. The country selects sensible currency and time-zone defaults. */
export type TaxRegime = 'GST' | 'VAT' | 'TAX';
export type Market = { code: string; name: string; currency: string; timezone: string; /** Name of the indirect tax shown to users. */ taxRegime: TaxRegime };

/** Oman is the default market and is listed first, followed by the other Gulf countries. */
export const DEFAULT_MARKET_CODE = 'OM';

export const MARKETS: readonly Market[] = [
  { code: 'OM', name: 'Oman', currency: 'OMR', timezone: 'Asia/Muscat', taxRegime: 'VAT' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai', taxRegime: 'VAT' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', timezone: 'Asia/Riyadh', taxRegime: 'VAT' },
  { code: 'QA', name: 'Qatar', currency: 'QAR', timezone: 'Asia/Qatar', taxRegime: 'TAX' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', timezone: 'Asia/Kuwait', taxRegime: 'TAX' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD', timezone: 'Asia/Bahrain', taxRegime: 'VAT' },
  { code: 'IN', name: 'India', currency: 'INR', timezone: 'Asia/Kolkata', taxRegime: 'GST' },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York', taxRegime: 'TAX' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London', taxRegime: 'VAT' },
  { code: 'DE', name: 'Germany', currency: 'EUR', timezone: 'Europe/Berlin', taxRegime: 'VAT' },
  { code: 'FR', name: 'France', currency: 'EUR', timezone: 'Europe/Paris', taxRegime: 'VAT' },
  { code: 'EU', name: 'Euro area', currency: 'EUR', timezone: 'UTC', taxRegime: 'VAT' },
  { code: 'ZZ', name: 'Other / choose currency', currency: 'OMR', timezone: 'UTC', taxRegime: 'TAX' },
] as const;

export function marketByCode(code: unknown): Market | undefined {
  return typeof code === 'string' ? MARKETS.find((market) => market.code === code.toUpperCase()) : undefined;
}

export function isMarketCode(code: unknown): code is string {
  return Boolean(marketByCode(code));
}

/** A suggested label. Organisations can override it in their profile. */
export function taxRegimeFor(code: unknown): TaxRegime {
  return marketByCode(code)?.taxRegime ?? 'TAX';
}

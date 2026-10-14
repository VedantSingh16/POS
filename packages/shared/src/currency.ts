/**
 * Currencies the organisation can choose from. Money is always stored as a whole number of the
 * currency's smallest unit (paise, baisa, fils, cents), so `decimals` says how many digits that is.
 * The Omani rial has three: 1 OMR = 1,000 baisa.
 */
export type CurrencyInfo = { code: string; name: string; symbol: string; decimals: number; majorName: string; minorName: string; /** Note values (in major units) for counting a cash drawer. */ notes: number[] };

export const DEFAULT_CURRENCY = 'OMR';

export const CURRENCIES: Record<string, CurrencyInfo> = {
  OMR: { code: 'OMR', name: 'Omani rial', symbol: 'OMR', decimals: 3, majorName: 'Omani Rials', minorName: 'Baisa', notes: [50, 20, 10, 5, 1, 0.5] },
  AED: { code: 'AED', name: 'UAE dirham', symbol: 'AED', decimals: 2, majorName: 'Dirhams', minorName: 'Fils', notes: [1000, 500, 200, 100, 50, 20, 10, 5] },
  SAR: { code: 'SAR', name: 'Saudi riyal', symbol: 'SAR', decimals: 2, majorName: 'Riyals', minorName: 'Halalas', notes: [500, 200, 100, 50, 10, 5] },
  QAR: { code: 'QAR', name: 'Qatari riyal', symbol: 'QAR', decimals: 2, majorName: 'Riyals', minorName: 'Dirhams', notes: [500, 200, 100, 50, 10, 5, 1] },
  KWD: { code: 'KWD', name: 'Kuwaiti dinar', symbol: 'KWD', decimals: 3, majorName: 'Dinars', minorName: 'Fils', notes: [20, 10, 5, 1, 0.5, 0.25] },
  BHD: { code: 'BHD', name: 'Bahraini dinar', symbol: 'BHD', decimals: 3, majorName: 'Dinars', minorName: 'Fils', notes: [20, 10, 5, 1, 0.5] },
  INR: { code: 'INR', name: 'Indian rupee', symbol: '₹', decimals: 2, majorName: 'Rupees', minorName: 'Paise', notes: [500, 200, 100, 50, 20, 10] },
  USD: { code: 'USD', name: 'US dollar', symbol: '$', decimals: 2, majorName: 'Dollars', minorName: 'Cents', notes: [100, 50, 20, 10, 5, 1] },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, majorName: 'Euros', minorName: 'Cents', notes: [200, 100, 50, 20, 10, 5] },
  GBP: { code: 'GBP', name: 'Pound sterling', symbol: '£', decimals: 2, majorName: 'Pounds', minorName: 'Pence', notes: [50, 20, 10, 5] },
};

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function currencyInfo(code: string | null | undefined): CurrencyInfo {
  return (code && CURRENCIES[code]) || CURRENCIES[DEFAULT_CURRENCY]!;
}

/** How many minor units make one major unit (1000 for OMR, 100 for INR). */
export function minorFactor(code: string | null | undefined): number {
  return 10 ** currencyInfo(code).decimals;
}

/** "OMR 12.345" / "₹499.00". `ascii` swaps symbols a PDF font cannot draw. */
export function formatMinor(minor: number, code: string | null | undefined, options: { symbol?: boolean; grouping?: boolean } = {}): string {
  const info = currencyInfo(code);
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / minorFactor(code)).toString();
  const grouped = options.grouping === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = String(abs % minorFactor(code)).padStart(info.decimals, '0');
  const number = `${grouped}${info.decimals ? `.${fraction}` : ''}`;
  const symbol = options.symbol === false ? '' : info.symbol.length > 1 ? `${info.symbol} ` : info.symbol;
  return `${negative ? '-' : ''}${symbol}${number}`;
}

/** "12.5" typed by a person → minor units (12500 for OMR). Returns NaN for text that is not a number. */
export function parseMinor(text: string | number, code: string | null | undefined): number {
  const value = typeof text === 'number' ? text : Number(String(text).replace(/,/g, '').trim());
  return Number.isFinite(value) ? Math.round(value * minorFactor(code)) : Number.NaN;
}

/** Minor units → the plain number a person types into a box ("12.500"). */
export function minorToInput(minor: number, code: string | null | undefined): string {
  return (minor / minorFactor(code)).toFixed(currencyInfo(code).decimals);
}

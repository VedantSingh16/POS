import { DEFAULT_CURRENCY, isCurrencyCode } from '@pos/shared/currency';

/** The organisation's currency from its settings; new organisations use the Omani rial until they choose another. */
export function currencyFromSettings(settings: Record<string, unknown> | null | undefined): string {
  const value = settings?.currency;
  return isCurrencyCode(value) ? value : DEFAULT_CURRENCY;
}

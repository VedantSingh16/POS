/** GSTIN / tax-number helpers. A GSTIN is 15 characters: 2-digit state code, 10-character PAN, entity, 'Z', check character. */

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
};

export function normalizeTaxNumber(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = CHARSET.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36]!;
}

export type GstinCheck = { valid: boolean; normalized: string; stateCode: string; error?: string };

export function validateGstin(value: string | null | undefined): GstinCheck {
  const normalized = normalizeTaxNumber(value);
  const stateCode = normalized.slice(0, 2);
  if (!normalized) return { valid: false, normalized, stateCode: '', error: 'Tax number is empty' };
  if (!SHAPE.test(normalized)) return { valid: false, normalized, stateCode, error: 'GSTIN must be 15 characters in the standard format' };
  if (!GST_STATES[stateCode]) return { valid: false, normalized, stateCode, error: `Unknown GST state code ${stateCode}` };
  if (gstinCheckChar(normalized.slice(0, 14)) !== normalized[14]) return { valid: false, normalized, stateCode, error: 'GSTIN check character does not match' };
  return { valid: true, normalized, stateCode };
}

export function gstinStateCode(value: string | null | undefined): string {
  const normalized = normalizeTaxNumber(value);
  return /^[0-9]{2}/.test(normalized) ? normalized.slice(0, 2) : '';
}

/**
 * Place of supply. Intra-state (CGST + SGST) when seller and buyer are in the same state, or the buyer's state is unknown
 * (an unregistered walk-in is treated as supplied in the seller's state). Different states: IGST.
 */
export function isIntraState(sellerStateCode: string | null | undefined, buyerStateCode: string | null | undefined): boolean {
  const seller = (sellerStateCode ?? '').trim();
  const buyer = (buyerStateCode ?? '').trim();
  if (!seller || !buyer) return true;
  return seller === buyer;
}

/**
 * Omani VAT registration number: "OM" followed by 9 digits and a final digit or X (e.g. OM1100012379).
 * The check is shape-only; the Tax Authority is the source of truth for whether a number is active.
 */
const OMAN_VATIN = /^OM[0-9]{9}[0-9X]$/;

export function validateOmanVatNumber(value: string | null | undefined): GstinCheck {
  const normalized = normalizeTaxNumber(value);
  if (!normalized) return { valid: false, normalized, stateCode: '', error: 'Tax number is empty' };
  if (!OMAN_VATIN.test(normalized)) return { valid: false, normalized, stateCode: '', error: 'Omani VAT number is "OM" followed by 10 characters, for example OM1100012379' };
  return { valid: true, normalized, stateCode: '' };
}

/** Validates a tax registration number for the given country. India uses GSTIN, Oman uses the OM VAT number, others accept 5-20 letters or digits. */
export function validateTaxNumber(countryCode: string | null | undefined, value: string | null | undefined): GstinCheck {
  const country = (countryCode ?? '').toUpperCase();
  if (country === 'IN') return validateGstin(value);
  if (country === 'OM') return validateOmanVatNumber(value);
  const normalized = normalizeTaxNumber(value);
  if (!normalized) return { valid: false, normalized, stateCode: '', error: 'Tax number is empty' };
  if (!/^[A-Z0-9-]{5,20}$/.test(normalized)) return { valid: false, normalized, stateCode: '', error: 'Enter a valid tax number (5 to 20 letters or digits)' };
  return { valid: true, normalized, stateCode: '' };
}

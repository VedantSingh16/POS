/**
 * Country-specific address formats. Oman follows its national addressing style (governorate, wilayat, area, way,
 * building, unit, landmark, optional P.O. Box and optional 3-digit postal code). Every other country keeps the
 * generic form (street, city, state/region, postal code).
 *
 * The structured parts are stored in `addressDetails` and a one-line `address`, `city` (wilayat) and `region`
 * (governorate) are derived from them, so receipts, reports and older screens keep working unchanged.
 */

export type OmanGovernorate = { name: string; nameAr: string; wilayats: readonly string[] };

/** The 11 governorates of Oman. Both governorates and wilayats are suggestions, not a closed registry. */
export const OMAN_GOVERNORATES: readonly OmanGovernorate[] = [
  { name: 'Muscat', nameAr: 'مسقط', wilayats: ['Muscat', 'Muttrah', 'Bawshar', 'As Seeb', 'Al Amerat', 'Qurayyat'] },
  { name: 'Dhofar', nameAr: 'ظفار', wilayats: ['Salalah', 'Taqah', 'Mirbat', 'Sadah', 'Rakhyut', 'Thumrait', 'Dhalkut', 'Al Mazyona', 'Muqshin', 'Shalim and the Hallaniyat Islands'] },
  { name: 'Musandam', nameAr: 'مسندم', wilayats: ['Khasab', 'Bukha', 'Dibba Al Baya', 'Madha'] },
  { name: 'Al Buraimi', nameAr: 'البريمي', wilayats: ['Al Buraimi', 'Mahdah', 'As Sunaynah'] },
  { name: 'Ad Dakhiliyah', nameAr: 'الداخلية', wilayats: ['Nizwa', 'Samail', 'Bahla', 'Adam', 'Al Hamra', 'Manah', 'Izki', 'Bidbid', 'Jabal Akhdar'] },
  { name: 'Al Batinah North', nameAr: 'شمال الباطنة', wilayats: ['Sohar', 'Shinas', 'Liwa', 'Saham', 'Al Khaburah', 'As Suwayq'] },
  { name: 'Al Batinah South', nameAr: 'جنوب الباطنة', wilayats: ['Rustaq', 'Al Awabi', 'Nakhal', 'Wadi Al Maawil', 'Barka', 'Al Musannah'] },
  { name: 'Ash Sharqiyah North', nameAr: 'شمال الشرقية', wilayats: ['Ibra', 'Al Mudhaibi', 'Bidiyah', 'Al Qabil', 'Wadi Bani Khalid', 'Dima Wa Al Taiyyin'] },
  { name: 'Ash Sharqiyah South', nameAr: 'جنوب الشرقية', wilayats: ['Sur', 'Al Kamil Wal Wafi', 'Jalan Bani Bu Hassan', 'Jalan Bani Bu Ali', 'Masirah'] },
  { name: 'Ad Dhahirah', nameAr: 'الظاهرة', wilayats: ['Ibri', 'Yanqul', 'Dhank'] },
  { name: 'Al Wusta', nameAr: 'الوسطى', wilayats: ['Haima', 'Mahout', 'Al Duqm', 'Al Jazir'] },
];

export type OmanAddressKey = 'governorate' | 'wilayat' | 'area' | 'way' | 'building' | 'unit' | 'landmark' | 'poBox' | 'postalCode';
export type OmanAddressDetails = Partial<Record<OmanAddressKey, string>>;

export type OmanAddressField = { key: OmanAddressKey; label: string; required: boolean; maxLength: number; placeholder: string; hint?: string; inputMode?: 'numeric' | 'text' };

/** Field order and labels for the Omani address form. Labels are UI strings and are translated by the web app. */
export const OMAN_ADDRESS_FIELDS: readonly OmanAddressField[] = [
  { key: 'governorate', label: 'Governorate', required: true, maxLength: 40, placeholder: '' },
  { key: 'wilayat', label: 'Wilayat', required: true, maxLength: 80, placeholder: 'e.g. Bawshar' },
  { key: 'area', label: 'Area / locality', required: true, maxLength: 80, placeholder: 'e.g. Al Khuwair' },
  { key: 'way', label: 'Way / street', required: false, maxLength: 80, placeholder: 'e.g. Way 3015' },
  { key: 'building', label: 'Building / house no.', required: false, maxLength: 40, placeholder: 'e.g. 1234' },
  { key: 'unit', label: 'Unit / shop / floor', required: false, maxLength: 40, placeholder: 'e.g. Shop 5, 1st floor' },
  { key: 'landmark', label: 'Landmark', required: false, maxLength: 120, placeholder: 'e.g. Near Lulu Hypermarket' },
  { key: 'poBox', label: 'P.O. Box', required: false, maxLength: 6, placeholder: 'e.g. 1234', inputMode: 'numeric' },
  { key: 'postalCode', label: 'Postal code (3 digits)', required: false, maxLength: 3, placeholder: 'e.g. 133', inputMode: 'numeric' },
];

export const isOmanCountry = (countryCode: unknown): boolean => typeof countryCode === 'string' && countryCode.toUpperCase() === 'OM';

export function omanGovernorate(name: unknown): OmanGovernorate | undefined {
  return typeof name === 'string' ? OMAN_GOVERNORATES.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase()) : undefined;
}

export type OmanAddressCheck = { valid: boolean; errors: Partial<Record<OmanAddressKey, string>>; details: OmanAddressDetails };

/** Trims, validates and returns the cleaned address parts. Unknown keys are dropped. */
export function validateOmanAddress(input: unknown): OmanAddressCheck {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const details: OmanAddressDetails = {};
  const errors: Partial<Record<OmanAddressKey, string>> = {};
  for (const field of OMAN_ADDRESS_FIELDS) {
    const raw = source[field.key];
    const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!value) {
      if (field.required) errors[field.key] = `${field.label} is required`;
      continue;
    }
    if (value.length > field.maxLength) { errors[field.key] = `${field.label} must be ${field.maxLength} characters or fewer`; continue; }
    details[field.key] = value;
  }
  if (details.governorate) {
    const match = omanGovernorate(details.governorate);
    if (match) details.governorate = match.name;
    // Keep a valid free-text entry when the built-in list has not caught up.
  }
  if (details.wilayat && details.wilayat.length < 2) errors.wilayat = 'Wilayat must be at least 2 characters';
  if (details.area && details.area.length < 2) errors.area = 'Area must be at least 2 characters';
  if (details.poBox && !/^[0-9]{1,6}$/.test(details.poBox)) errors.poBox = 'P.O. Box must be digits only';
  if (details.postalCode && !/^[0-9]{3}$/.test(details.postalCode)) errors.postalCode = 'Postal code in Oman has exactly 3 digits';
  return { valid: Object.keys(errors).length === 0, errors, details };
}

/** One-line address plus the legacy columns derived from the structured parts. */
export function composeOmanAddress(details: OmanAddressDetails): { address: string; city: string; region: string; postalCode: string } {
  const first = [details.unit, details.building ? `Building ${details.building}` : '', details.way].filter(Boolean).join(', ');
  const lines = [first, details.area, details.landmark ? `Near ${details.landmark.replace(/^near\s+/i, '')}` : '', details.poBox ? `P.O. Box ${details.poBox}` : ''].filter(Boolean);
  return { address: lines.join(', '), city: details.wilayat ?? '', region: details.governorate ?? '', postalCode: details.postalCode ?? '' };
}

/**
 * Omani numbers have 8 digits and start with 2 (landline), 7 or 9 (mobile). Accepts "+968 9123 4567", "00968 91234567" or "91234567"
 * and returns "+96891234567". Empty input is allowed because the phone is optional.
 */
export function normalizeOmanPhone(value: unknown): { valid: boolean; phone: string; error?: string } {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { valid: true, phone: '' };
  let digits = raw.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('968') && digits.length === 11) digits = digits.slice(3);
  if (!/^[279][0-9]{7}$/.test(digits)) return { valid: false, phone: raw, error: 'Enter an Omani phone number: 8 digits starting with 2, 7 or 9 (for example +968 9123 4567)' };
  return { valid: true, phone: `+968${digits}` };
}

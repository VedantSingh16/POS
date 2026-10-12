export type Paise = number & { readonly __unit: 'paise' };

export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Money must be a non-negative safe integer in paise');
  return value as Paise;
}

export function addMoney(...values: number[]): Paise {
  return paise(values.reduce((sum, value) => sum + value, 0));
}

export function subtractMoney(left: number, right: number): Paise {
  return paise(left - right);
}

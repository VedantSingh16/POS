import { BadRequestException } from '@nestjs/common';

export type JsonObject = Record<string, unknown>;

/** Request-body parsing helpers. Controllers still receive untyped bodies; these give consistent 400s. */

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${field} is required`);
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export function finiteNumber(value: unknown, field: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) {
    throw new BadRequestException(`${field} must be a number`);
  }
  return number;
}

/** Money in integer minor units (paise). */
export function money(value: unknown, field = 'amountCents'): number {
  const number = finiteNumber(value, field);
  if (!Number.isInteger(number) || number < 0) {
    throw new BadRequestException(`${field} must be a non-negative integer in minor units`);
  }
  return number;
}

export function stringArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new BadRequestException('Expected an array of non-empty strings');
  }
  return value.map((item) => item.trim());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** An id supplied by a client. Malformed ids are a 400, not a database error. */
export function uuid(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!isUuid(text)) throw new BadRequestException(`${field} must be a valid id`);
  return text;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const text = requiredString(value, field).toUpperCase();
  if (!(allowed as readonly string[]).includes(text)) {
    throw new BadRequestException(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return text as T;
}

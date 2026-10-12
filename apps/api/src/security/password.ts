import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [algorithm, salt, storedKey] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !storedKey) return false;

  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  const expectedKey = Buffer.from(storedKey, 'hex');
  return expectedKey.length === derivedKey.length && timingSafeEqual(expectedKey, derivedKey);
}

import { describe, expect, it } from 'vitest';
import { isStoreOpenAt, validateStoreHours, type StoreOperatingHours } from '@pos/shared/store-hours';

const weekdays: StoreOperatingHours = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
};

describe('store operating hours', () => {
  it('validates a weekly schedule and opens during the configured interval', () => {
    expect(validateStoreHours(weekdays).valid).toBe(true);
    expect(isStoreOpenAt(weekdays, 'Asia/Muscat', new Date('2026-10-19T07:00:00Z'))).toBe(true);
    expect(isStoreOpenAt(weekdays, 'Asia/Muscat', new Date('2026-10-19T15:00:00Z'))).toBe(false);
  });

  it('handles overnight intervals on the following local day', () => {
    const schedule: StoreOperatingHours = { ...weekdays, monday: { open: '22:00', close: '02:00' }, tuesday: null };
    expect(isStoreOpenAt(schedule, 'Asia/Muscat', new Date('2026-10-19T19:30:00Z'))).toBe(true);
    expect(isStoreOpenAt(schedule, 'Asia/Muscat', new Date('2026-10-19T20:30:00Z'))).toBe(true);
    expect(isStoreOpenAt(schedule, 'Asia/Muscat', new Date('2026-10-19T23:00:00Z'))).toBe(false);
  });

  it('keeps an unset schedule unrestricted and rejects invalid times', () => {
    expect(isStoreOpenAt(null, 'Asia/Muscat', new Date('2026-10-19T03:00:00Z'))).toBe(true);
    expect(validateStoreHours({ monday: { open: '09:00', close: '09:00' } }).valid).toBe(false);
    expect(validateStoreHours({ monday: { open: '9:00', close: '18:00' } }).valid).toBe(false);
  });
});

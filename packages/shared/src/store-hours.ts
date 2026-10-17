export const STORE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export type StoreDay = (typeof STORE_DAYS)[number];
export type StoreDayHours = { open: string; close: string };
export type StoreOperatingHours = Record<StoreDay, StoreDayHours | null>;

export const EMPTY_STORE_HOURS: StoreOperatingHours = {
  monday: null,
  tuesday: null,
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
  sunday: null,
};

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function cloneStoreHours(value: StoreOperatingHours): StoreOperatingHours {
  return Object.fromEntries(STORE_DAYS.map((day) => [day, value[day] ? { ...value[day] } : null])) as StoreOperatingHours;
}

export function validateStoreHours(input: unknown): { valid: boolean; value: StoreOperatingHours; error?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, value: cloneStoreHours(EMPTY_STORE_HOURS), error: 'Operating hours must be an object' };
  const source = input as Record<string, unknown>;
  const value = cloneStoreHours(EMPTY_STORE_HOURS);
  for (const day of STORE_DAYS) {
    const entry = source[day];
    if (entry === null || entry === undefined || entry === false || entry === '') continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { valid: false, value, error: `${day} hours are invalid` };
    const open = typeof (entry as Record<string, unknown>).open === 'string' ? (entry as Record<string, string>).open : '';
    const close = typeof (entry as Record<string, unknown>).close === 'string' ? (entry as Record<string, string>).close : '';
    if (!TIME_PATTERN.test(open) || !TIME_PATTERN.test(close) || open === close) {
      return { valid: false, value, error: `${day} must have different opening and closing times in HH:mm format` };
    }
    value[day] = { open, close };
  }
  return { valid: true, value };
}

function localParts(now: Date, timeZone: string): { day: StoreDay; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value.toLowerCase() ?? 'monday';
  const day = weekday as StoreDay;
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return { day: STORE_DAYS.includes(day) ? day : 'monday', minutes: hour * 60 + minute };
}

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function previousDay(day: StoreDay): StoreDay {
  const index = STORE_DAYS.indexOf(day);
  return STORE_DAYS[(index + STORE_DAYS.length - 1) % STORE_DAYS.length];
}

/** Returns true when no schedule is configured, or when the store is open at the instant. */
export function isStoreOpenAt(schedule: StoreOperatingHours | null | undefined, timeZone: string, now = new Date()): boolean {
  if (!schedule) return true;
  const local = localParts(now, timeZone);
  const today = schedule[local.day];
  if (today) {
    const open = timeMinutes(today.open);
    const close = timeMinutes(today.close);
    if (close > open && local.minutes >= open && local.minutes < close) return true;
    if (close < open && local.minutes >= open) return true;
  }
  const previous = schedule[previousDay(local.day)];
  if (previous && timeMinutes(previous.close) < timeMinutes(previous.open) && local.minutes < timeMinutes(previous.close)) return true;
  return false;
}

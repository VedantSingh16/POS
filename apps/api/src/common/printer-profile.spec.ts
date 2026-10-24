import { applyPrinterPatch, readPrinterProfile } from './printer-profile.js';

const now = new Date('2026-10-23T06:00:00.000Z');

describe('register printer profile', () => {
  it('reads an empty or unknown value as "not set up"', () => {
    expect(readPrinterProfile({})).toEqual({ paper: null, setupConfirmedAt: null, setupConfirmedBy: null });
    expect(readPrinterProfile({ paper: '110mm' }).paper).toBeNull();
    expect(readPrinterProfile(null).paper).toBeNull();
  });

  it('confirms a printer and clears the confirmation when a different paper is chosen', () => {
    const chosen = applyPrinterPatch(readPrinterProfile({}), { paper: '80mm' }, 'Sayed', now);
    expect(chosen).toEqual({ paper: '80mm', setupConfirmedAt: null, setupConfirmedBy: null });
    const confirmed = applyPrinterPatch(chosen, { confirmed: true }, 'Sayed', now);
    expect(confirmed).toEqual({ paper: '80mm', setupConfirmedAt: now.toISOString(), setupConfirmedBy: 'Sayed' });
    expect(applyPrinterPatch(confirmed, { paper: '80mm' }, 'Sayed', now).setupConfirmedAt).toBe(now.toISOString());
    expect(applyPrinterPatch(confirmed, { paper: '58mm' }, 'Sayed', now)).toEqual({ paper: '58mm', setupConfirmedAt: null, setupConfirmedBy: null });
    expect(applyPrinterPatch(confirmed, { confirmed: false }, 'Sayed', now).setupConfirmedAt).toBeNull();
  });

  it('refuses bad values', () => {
    expect(() => applyPrinterPatch(readPrinterProfile({}), { paper: 'Letter' }, 'x', now)).toThrow('paper must be one of');
    expect(() => applyPrinterPatch(readPrinterProfile({}), { confirmed: 'yes' }, 'x', now)).toThrow('confirmed must be true or false');
    expect(() => applyPrinterPatch(readPrinterProfile({}), { confirmed: true }, 'x', now)).toThrow('Choose the paper size');
  });
});

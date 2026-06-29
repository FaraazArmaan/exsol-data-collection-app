import { describe, it, expect } from 'vitest';
import { zonedToUtc, utcToZonedParts, addMinutes } from '../lib/tz';

describe('zonedToUtc', () => {
  it('India has no DST: 09:15 IST → 03:45 UTC', () => {
    expect(zonedToUtc('2026-08-15T09:15:00', 'Asia/Kolkata').toISOString())
      .toBe('2026-08-15T03:45:00.000Z');
  });
  it('US Eastern in summer (EDT, -04:00): 09:00 → 13:00 UTC', () => {
    expect(zonedToUtc('2026-07-01T09:00:00', 'America/New_York').toISOString())
      .toBe('2026-07-01T13:00:00.000Z');
  });
  it('US Eastern in winter (EST, -05:00): 09:00 → 14:00 UTC', () => {
    expect(zonedToUtc('2026-01-15T09:00:00', 'America/New_York').toISOString())
      .toBe('2026-01-15T14:00:00.000Z');
  });
});

describe('utcToZonedParts', () => {
  it('maps a UTC instant to local wall-clock parts + weekday', () => {
    const p = utcToZonedParts(new Date('2026-08-15T03:45:00.000Z'), 'Asia/Kolkata');
    expect(p).toMatchObject({ y: 2026, m: 8, d: 15, hh: 9, mm: 15, weekday: 'sat' });
  });
});

describe('addMinutes', () => {
  it('adds minutes as pure instant math', () => {
    expect(addMinutes(new Date('2026-08-15T03:45:00.000Z'), 60).toISOString())
      .toBe('2026-08-15T04:45:00.000Z');
  });
});

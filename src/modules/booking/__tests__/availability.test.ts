import { describe, it, expect } from 'vitest';
import { computeAvailability, type DaySchedule } from '../lib/availability';

const weekly: DaySchedule = {
  mon: [{ open: '09:00', close: '11:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
};
const baseInput = {
  date: '2026-08-17', // a Monday
  timeZone: 'Asia/Kolkata',
  slotIntervalMin: 30,
  leadTimeMin: 0,
  now: new Date('2026-08-16T00:00:00Z'), // day before — nothing filtered by lead time
  tenantWeekly: weekly,
  service: { durationMin: 60, bufferMin: 0 },
  resources: [{ id: 'r1', weekly: null, busy: [] }],
};

describe('computeAvailability', () => {
  it('walks the open window in slot steps; last fitting 60-min start is 10:00', () => {
    const slots = computeAvailability(baseInput);
    // 09:00, 09:30, 10:00 all fit a 60-min service ending by 11:00; 10:30 would end 11:30 → excluded
    const starts = slots.map((s) => s.startUtc.toISOString());
    expect(starts).toEqual([
      '2026-08-17T03:30:00.000Z', // 09:00 IST
      '2026-08-17T04:00:00.000Z', // 09:30
      '2026-08-17T04:30:00.000Z', // 10:00
    ]);
    expect(slots.every((s) => s.resourceId === 'r1')).toBe(true);
  });

  it('excludes a start whose range overlaps a busy interval', () => {
    const slots = computeAvailability({
      ...baseInput,
      resources: [{ id: 'r1', weekly: null,
        busy: [{ start: new Date('2026-08-17T04:00:00.000Z'), end: new Date('2026-08-17T05:00:00.000Z') }] }],
    });
    // 09:00 (ends 10:00 = 04:30Z) overlaps busy 04:00–05:00 → excluded; 09:30 overlaps; 10:00 overlaps
    expect(slots).toEqual([]);
  });

  it('applies lead time relative to now', () => {
    const slots = computeAvailability({
      ...baseInput,
      now: new Date('2026-08-17T04:00:00.000Z'), // 09:30 IST
      leadTimeMin: 0,
    });
    expect(slots.map((s) => s.startUtc.toISOString())).toEqual([
      '2026-08-17T04:00:00.000Z', '2026-08-17T04:30:00.000Z',
    ]);
  });

  it('closed weekday yields no slots', () => {
    expect(computeAvailability({ ...baseInput, date: '2026-08-18' /* Tuesday, empty */ })).toEqual([]);
  });
});

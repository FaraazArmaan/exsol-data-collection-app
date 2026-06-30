import { describe, it, expect } from 'vitest';
import { buildIcs } from '../ics';

describe('buildIcs', () => {
  it('emits a valid VEVENT with UTC basic-format times', () => {
    const ics = buildIcs({
      uid: 'tok-123@exsol', title: 'Haircut',
      startIso: '2026-08-17T03:30:00.000Z', endIso: '2026-08-17T04:00:00.000Z',
    });
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:tok-123@exsol');
    expect(ics).toContain('DTSTART:20260817T033000Z');
    expect(ics).toContain('DTEND:20260817T040000Z');
    expect(ics).toContain('SUMMARY:Haircut');
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
  });
});

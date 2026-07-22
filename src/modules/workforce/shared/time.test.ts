import { describe, expect, it } from 'vitest';
import { formatWorkforceTime, workforceDateKey } from './time';

describe('Workforce time formatting', () => {
  it('uses the workspace timezone instead of the viewer timezone', () => {
    const instant = '2026-07-20T19:30:00.000Z';

    expect(formatWorkforceTime(instant, 'Asia/Kolkata')).toBe('1:00 AM');
    expect(workforceDateKey(instant, 'Asia/Kolkata')).toBe('2026-07-21');
    expect(workforceDateKey(instant, 'America/Los_Angeles')).toBe('2026-07-20');
  });
});

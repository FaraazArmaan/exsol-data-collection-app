import { describe, it, expect } from 'vitest';
import { AnalyticsQuery } from '../../netlify/functions/_analytics-validators';

describe('AnalyticsQuery', () => {
  it('parses a full query', () => {
    const q = AnalyticsQuery.parse({
      from: '2026-06-01', to: '2026-06-30', compare: 'prior_period', granularity: 'week',
    });
    expect(q.granularity).toBe('week');
    expect(q.compare).toBe('prior_period');
  });
  it('defaults compare and granularity', () => {
    const q = AnalyticsQuery.parse({ from: '2026-06-01', to: '2026-06-30' });
    expect(q.compare).toBe('none');
    expect(q.granularity).toBe('day');
  });
  it('rejects a malformed date', () => {
    expect(() => AnalyticsQuery.parse({ from: '06/01/2026', to: '2026-06-30' })).toThrow();
  });
  it('rejects an unknown compare mode', () => {
    expect(() => AnalyticsQuery.parse({ from: '2026-06-01', to: '2026-06-30', compare: 'mtd' })).toThrow();
  });
});

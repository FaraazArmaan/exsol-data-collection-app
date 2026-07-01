import { describe, it, expect } from 'vitest';
import { compareWindow, pctDelta } from '../../netlify/functions/_analytics-sql';

describe('compareWindow', () => {
  it('prior_period returns the immediately preceding equal-length window', () => {
    // 2026-06-08..2026-06-14 inclusive = 7 days → prior = 2026-06-01..2026-06-07
    expect(compareWindow('2026-06-08', '2026-06-14', 'prior_period')).toEqual({
      from: '2026-06-01', to: '2026-06-07',
    });
  });
  it('prior_period works for a single-day window', () => {
    expect(compareWindow('2026-06-08', '2026-06-08', 'prior_period')).toEqual({
      from: '2026-06-07', to: '2026-06-07',
    });
  });
  it('prior_year shifts back exactly one year', () => {
    expect(compareWindow('2026-06-08', '2026-06-14', 'prior_year')).toEqual({
      from: '2025-06-08', to: '2025-06-14',
    });
  });
  it('none returns null', () => {
    expect(compareWindow('2026-06-08', '2026-06-14', 'none')).toBeNull();
  });
  it('prior_year handles a leap day by rolling into March (no invalid date)', () => {
    // 2024-02-29 has no counterpart in 2023 → JS Date rolls to 2023-03-01.
    expect(compareWindow('2024-02-29', '2024-02-29', 'prior_year')).toEqual({
      from: '2023-03-01', to: '2023-03-01',
    });
  });
});

describe('pctDelta', () => {
  it('computes percent change', () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(50, 100)).toBe(-50);
  });
  it('returns null when prior is zero (no baseline)', () => {
    expect(pctDelta(100, 0)).toBeNull();
  });
});

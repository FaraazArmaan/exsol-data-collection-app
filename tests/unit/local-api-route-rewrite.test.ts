import { describe, expect, it } from 'vitest';
import { rewriteLocalApiPath } from '../../vite.local-api.config';

describe('local API route rewrite', () => {
  it('preserves configured API paths and rewrites filename-routed functions', () => {
    expect(rewriteLocalApiPath('/api/booking/setup')).toBe('/api/booking/setup');
    expect(rewriteLocalApiPath('/api/booking-public/papa/availability?date=2026-07-20'))
      .toBe('/api/booking-public/papa/availability?date=2026-07-20');
    expect(rewriteLocalApiPath('/api/u-me')).toBe('/.netlify/functions/u-me');
  });
});

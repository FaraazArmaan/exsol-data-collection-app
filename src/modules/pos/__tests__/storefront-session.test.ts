// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getOrCreateStorefrontSession } from '../lib/session';

beforeEach(() => sessionStorage.clear());

describe('getOrCreateStorefrontSession', () => {
  it('returns a stable id across calls within the tab', () => {
    const a = getOrCreateStorefrontSession();
    const b = getOrCreateStorefrontSession();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it('mints a fresh id after the session is cleared (new tab)', () => {
    const a = getOrCreateStorefrontSession();
    sessionStorage.clear();
    const b = getOrCreateStorefrontSession();
    expect(b).not.toBe(a);
  });
});

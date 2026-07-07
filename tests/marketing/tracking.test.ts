import { describe, it, expect } from 'vitest';
import { assignVariant, openPixelTag, withOpenPixel } from '../../src/modules/marketing/lib/tracking';

describe('A/B variant assignment', () => {
  it('is deterministic for a given key', () => {
    const k = 'someone@example.com';
    expect(assignVariant(k, 50)).toBe(assignVariant(k, 50));
  });

  it('honours the boundary splits', () => {
    expect(assignVariant('a@x.com', 100)).toBe('A');
    expect(assignVariant('a@x.com', 0)).toBe('B');
  });

  it('splits roughly by percentage across many keys', () => {
    let a = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) if (assignVariant(`user-${i}@x.com`, 50) === 'A') a++;
    // Deterministic hash, so this is exact per run — assert a sane spread, not 50/50 precisely.
    expect(a).toBeGreaterThan(N * 0.35);
    expect(a).toBeLessThan(N * 0.65);
  });
});

describe('open pixel', () => {
  it('builds an absolute pixel URL carrying the send id', () => {
    const tag = openPixelTag('11111111-1111-1111-1111-111111111111', 'https://app.test/');
    expect(tag).toContain('https://app.test/api/marketing/track/open?s=11111111-1111-1111-1111-111111111111');
    expect(tag).toContain('width="1"');
  });

  it('appends the pixel to the body', () => {
    const html = withOpenPixel('<p>Hi</p>', 'abc', 'https://app.test');
    expect(html.startsWith('<p>Hi</p>')).toBe(true);
    expect(html).toContain('track/open?s=abc');
  });
});

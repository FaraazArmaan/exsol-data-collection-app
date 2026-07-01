import { describe, expect, test } from 'vitest';
import { downscaleImage, MAX_EDGE } from '../../src/modules/branding/downscale';

describe('MAX_EDGE caps', () => {
  test('per-kind longest-edge caps are the intended values', () => {
    expect(MAX_EDGE.favicon).toBe(64);
    expect(MAX_EDGE.app_icon).toBe(512);
    expect(MAX_EDGE.logo).toBe(400);
    expect(MAX_EDGE.logo_alt).toBe(400);
    expect(MAX_EDGE.social).toBe(1200);
    expect(MAX_EDGE.hero).toBe(1600);
  });
});

describe('downscaleImage graceful fallback', () => {
  test('returns the original file when canvas/createImageBitmap is unavailable (node env)', async () => {
    const original = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    const out = await downscaleImage(original, 'logo');
    // In node there is no createImageBitmap → early return → original unchanged.
    expect(out).toBe(original);
  });
});

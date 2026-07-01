import { describe, expect, test } from 'vitest';
import { isHexColor, onAccent, dominantColorFromPixels, isAllowlistedFont, BRAND_FONT_ALLOWLIST } from '../../src/modules/branding/branding';

describe('isHexColor', () => {
  test('accepts #rrggbb', () => { expect(isHexColor('#3b82f6')).toBe(true); expect(isHexColor('#FFFFFF')).toBe(true); });
  test('rejects malformed', () => { expect(isHexColor('#fff')).toBe(false); expect(isHexColor('3b82f6')).toBe(false); expect(isHexColor('#zzzzzz')).toBe(false); });
});

describe('onAccent', () => {
  test('dark accent → white text', () => { expect(onAccent('#161616')).toBe('#ffffff'); expect(onAccent('#3b82f6')).toBe('#ffffff'); });
  test('light accent → black text', () => { expect(onAccent('#ffffff')).toBe('#161616'); expect(onAccent('#fde047')).toBe('#161616'); });
});

describe('dominantColorFromPixels', () => {
  test('solid saturated red → a red-ish hex', () => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < px.length; i += 4) { px[i] = 220; px[i+1] = 20; px[i+2] = 20; px[i+3] = 255; }
    const hex = dominantColorFromPixels(px);
    expect(hex).not.toBeNull();
    expect(hex!.startsWith('#')).toBe(true);
  });
  test('near-white only → null', () => {
    const px = new Uint8ClampedArray(4 * 100);
    for (let i = 0; i < px.length; i += 4) { px[i] = 250; px[i+1] = 250; px[i+2] = 250; px[i+3] = 255; }
    expect(dominantColorFromPixels(px)).toBeNull();
  });
});

describe('font allowlist', () => {
  test('isAllowlistedFont matches a known family and rejects unknown / null', () => {
    expect(isAllowlistedFont('Inter')).toBe(true);
    expect(isAllowlistedFont('Comic Sans MS')).toBe(false);
    expect(isAllowlistedFont(null)).toBe(false);
    expect(isAllowlistedFont(undefined)).toBe(false);
  });
  test('every allowlist entry has family + pkg + category', () => {
    for (const f of BRAND_FONT_ALLOWLIST) {
      expect(typeof f.family).toBe('string');
      expect(f.pkg.startsWith('@fontsource')).toBe(true);
      expect(['sans','serif','display','mono']).toContain(f.category);
    }
  });
});

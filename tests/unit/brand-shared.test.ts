import { describe, expect, test } from 'vitest';
import {
  brandKey, heroKey, isAllowedBrandKey, keyBelongsToClient, sniffImageMime,
  BRAND_ALLOWED_MIME, MAX_BRAND_BYTES, BRAND_STORE_NAME,
} from '../../netlify/functions/_shared/brand';

const C = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SLIDE = '33333333-3333-4333-8333-333333333333';

describe('brand keys', () => {
  test('brandKey builds a stable per-kind key', () => {
    expect(brandKey(C, 'logo')).toBe(`brand/${C}/logo`);
    expect(brandKey(C, 'favicon')).toBe(`brand/${C}/favicon`);
  });
  test('heroKey embeds client + slide uuid', () => {
    expect(heroKey(C, SLIDE)).toBe(`brand/${C}/hero/${SLIDE}`);
  });
  test('isAllowedBrandKey accepts the 5 stable kinds + hero pattern', () => {
    for (const k of ['logo','logo_alt','favicon','app_icon','social']) {
      expect(isAllowedBrandKey(`brand/${C}/${k}`)).toBe(true);
    }
    expect(isAllowedBrandKey(`brand/${C}/hero/${SLIDE}`)).toBe(true);
  });
  test('isAllowedBrandKey rejects typos, traversal, missing uuid', () => {
    expect(isAllowedBrandKey(`brand/${C}/logoo`)).toBe(false);
    expect(isAllowedBrandKey(`brand/${C}/hero/not-a-uuid`)).toBe(false);
    expect(isAllowedBrandKey(`brand/../secret`)).toBe(false);
    // Traversal within a structurally-valid UUID path: the anchored regex
    // requires the segment right after the client uuid to be one of the 5
    // kinds (or `hero`), so an injected `../<uuid>` segment cannot pass.
    expect(isAllowedBrandKey(`brand/${C}/../${OTHER}/logo`)).toBe(false);
    expect(isAllowedBrandKey(`brand/${C}/logo/../${OTHER}/logo`)).toBe(false);
    expect(isAllowedBrandKey(`product-images/${C}/x`)).toBe(false);
    expect(isAllowedBrandKey('')).toBe(false);
  });
  test('keyBelongsToClient compares the embedded client uuid', () => {
    expect(keyBelongsToClient(`brand/${C}/logo`, C)).toBe(true);
    expect(keyBelongsToClient(`brand/${C}/hero/${SLIDE}`, C)).toBe(true);
    expect(keyBelongsToClient(`brand/${OTHER}/logo`, C)).toBe(false);
    expect(keyBelongsToClient('not-a-key', C)).toBe(false);
  });
});

describe('sniffImageMime', () => {
  const png  = new Uint8Array([0x89,0x50,0x4e,0x47,0,0,0,0,0,0,0,0]).buffer;
  const jpeg = new Uint8Array([0xff,0xd8,0xff,0,0,0,0,0,0,0,0,0]).buffer;
  const gif  = new Uint8Array([0x47,0x49,0x46,0,0,0,0,0,0,0,0,0]).buffer;
  const webp = new Uint8Array([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]).buffer;
  const short = new Uint8Array([0x52,0x49,0x46]).buffer;
  test('detects png/jpeg/gif/webp', () => {
    expect(sniffImageMime(png)).toBe('image/png');
    expect(sniffImageMime(jpeg)).toBe('image/jpeg');
    expect(sniffImageMime(gif)).toBe('image/gif');
    expect(sniffImageMime(webp)).toBe('image/webp');
  });
  test('length-guards the webp check and returns null for unknown', () => {
    expect(sniffImageMime(short)).toBeNull();
    expect(sniffImageMime(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12]).buffer)).toBeNull();
  });
});

describe('constants', () => {
  test('allowed mime set + cap + store name', () => {
    expect(BRAND_STORE_NAME).toBe('brand');
    expect(BRAND_ALLOWED_MIME.has('image/webp')).toBe(true);
    expect(BRAND_ALLOWED_MIME.has('image/gif')).toBe(false);
    expect(MAX_BRAND_BYTES).toBe(5 * 1024 * 1024);
  });
});

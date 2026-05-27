import { describe, expect, test } from 'vitest';
import { assertUuid, deriveSlug, isValidSlug, isValidUuid } from '../../netlify/functions/_shared/identifier';

describe('identifier helpers', () => {
  test('isValidUuid accepts canonical v4', () => {
    expect(isValidUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isValidUuid('aBcDeF12-3456-7890-1234-567890abcdef')).toBe(true);
  });
  test('isValidUuid rejects non-uuid', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
  });
  test('assertUuid throws with field hint', () => {
    expect(() => assertUuid('bad', 'clientId')).toThrow('invalid_uuid:clientId');
  });
  test('deriveSlug lowercases + hyphenates + trims', () => {
    expect(deriveSlug("Joe's Hardware!!")).toBe('joe-s-hardware');
    expect(deriveSlug('  Bistro Verde  ')).toBe('bistro-verde');
  });
  test('deriveSlug falls back to prefix when input is degenerate', () => {
    const out = deriveSlug('!!!', () => 'abcd1234');
    expect(out).toMatch(/^c-abcd1234$/);
  });
  test('isValidSlug enforces 2-60 alphanumeric+hyphen, alnum endpoints', () => {
    expect(isValidSlug('ab')).toBe(true);
    expect(isValidSlug('joes-hardware-2')).toBe(true);
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('trailing-')).toBe(false);
    expect(isValidSlug('a')).toBe(false);
  });
});

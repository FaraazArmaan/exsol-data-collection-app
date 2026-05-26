import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../../netlify/functions/_shared/templates';
import { isValidIdentifier } from '../../netlify/functions/_shared/identifier';

describe('templates', () => {
  const keys = Object.keys(TEMPLATES);
  it('has all 6 expected keys', () => {
    expect(keys.sort()).toEqual(['clinic', 'hospital', 'hotel', 'restaurant', 'shop', 'store']);
  });
  it.each(keys)('%s: keys round-trip', (k) => {
    expect(TEMPLATES[k]!.key).toBe(k);
  });
  it.each(keys)('%s: all role + column keys are valid identifiers', (k) => {
    const t = TEMPLATES[k]!;
    for (const r of t.roles) {
      expect(isValidIdentifier(r.key)).toBe(true);
      for (const c of r.columns) expect(isValidIdentifier(c.key)).toBe(true);
    }
  });
  it.each(keys)('%s: version is 1', (k) => {
    expect(TEMPLATES[k]!.version).toBe(1);
  });
});

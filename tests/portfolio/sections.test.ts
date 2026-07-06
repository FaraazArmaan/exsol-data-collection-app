import { describe, it, expect } from 'vitest';
import { mergeSections } from '../../src/modules/portfolio/shared/sections';
import { DEFAULT_SECTIONS } from '../../src/modules/portfolio/shared/types';

describe('mergeSections', () => {
  it('returns all-enabled defaults for empty / invalid input', () => {
    expect(mergeSections(null)).toEqual(DEFAULT_SECTIONS);
    expect(mergeSections({})).toEqual(DEFAULT_SECTIONS);
    expect(mergeSections('nope')).toEqual(DEFAULT_SECTIONS);
  });

  it('preserves stored toggles + copy and fills missing sections', () => {
    const merged = mergeSections({
      gallery: { enabled: false },
      hero: { tagline: 'Hi' },
      contact: { email: 'a@b.c' },
    });
    expect(merged.gallery.enabled).toBe(false);   // preserved
    expect(merged.hero.enabled).toBe(true);        // filled default
    expect(merged.hero.tagline).toBe('Hi');        // preserved
    expect(merged.contact.email).toBe('a@b.c');    // preserved
    expect(merged.contact.phone).toBe('');         // filled default
    expect(merged.products.enabled).toBe(true);    // filled default
  });

  it('ignores wrong-typed values, falling back to defaults', () => {
    const merged = mergeSections({ hero: { enabled: 'yes', tagline: 42 }, contact: 5 });
    expect(merged.hero.enabled).toBe(true);
    expect(merged.hero.tagline).toBe('');
    expect(merged.contact.enabled).toBe(true);
  });
});

import { DEFAULT_SECTIONS, type SiteSections } from './types';

// Merge a stored (possibly partial / legacy) sections object over the defaults
// so the editor AND the public page always render a complete, well-typed shape
// regardless of what's in the JSONB. Pure — unit-tested.
export function mergeSections(raw: unknown): SiteSections {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
  return {
    hero: {
      enabled: bool(r.hero?.enabled, DEFAULT_SECTIONS.hero.enabled),
      tagline: str(r.hero?.tagline, DEFAULT_SECTIONS.hero.tagline),
    },
    products: { enabled: bool(r.products?.enabled, DEFAULT_SECTIONS.products.enabled) },
    gallery: { enabled: bool(r.gallery?.enabled, DEFAULT_SECTIONS.gallery.enabled) },
    booking: { enabled: bool(r.booking?.enabled, DEFAULT_SECTIONS.booking.enabled) },
    contact: {
      enabled: bool(r.contact?.enabled, DEFAULT_SECTIONS.contact.enabled),
      email: str(r.contact?.email, ''),
      phone: str(r.contact?.phone, ''),
      address: str(r.contact?.address, ''),
    },
  };
}

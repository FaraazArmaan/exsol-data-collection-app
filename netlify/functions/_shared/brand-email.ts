// Loads a client's branding for use in transactional email templates.
// Mirrors pub-brand.ts's column read, but keyed by clientId (every send site
// has clientId, not slug) and returns an ABSOLUTE logo URL (email clients can't
// resolve the relative /api/public/brand/... path) using PUBLIC_BASE_URL.
import { db } from './db';

export interface EmailBrand {
  name: string;
  slug: string;
  accent: string;            // hex; falls back to a sensible default
  theme: 'dark' | 'light';
  fontHeading: string | null;
  fontBody: string | null;
  logoUrl: string | null;    // absolute, or null when no logo set
}

export async function loadBrandForEmail(clientId: string): Promise<EmailBrand> {
  const sql = db();
  const rows = (await sql`
    SELECT name, slug, brand_logo_key, brand_accent, brand_theme,
           brand_font_heading, brand_font_body
    FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{
    name: string; slug: string; brand_logo_key: string | null;
    brand_accent: string | null; brand_theme: 'dark' | 'light' | null;
    brand_font_heading: string | null; brand_font_body: string | null;
  }>;
  const r = rows[0];
  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  const logoUrl = r?.brand_logo_key && r.slug
    ? `${base}/api/public/brand/${encodeURIComponent(r.slug)}/image/${r.brand_logo_key}`
    : null;
  return {
    name: r?.name ?? 'Your workspace',
    slug: r?.slug ?? '',
    accent: r?.brand_accent ?? '#3b82f6',
    theme: r?.brand_theme ?? 'dark',
    fontHeading: r?.brand_font_heading ?? null,
    fontBody: r?.brand_font_body ?? null,
    logoUrl,
  };
}

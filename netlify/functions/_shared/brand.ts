// Shared platform-branding helpers: blob store, key formats, magic-byte sniff,
// and a module-agnostic slug resolver. See ADR-0001 + the branding spec.
import { getStore } from '@netlify/blobs';
import { db } from './db';

export const BRAND_STORE_NAME = 'brand';
export const BRAND_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_BRAND_BYTES = 5 * 1024 * 1024;

export function brandStore() {
  return getStore({ name: BRAND_STORE_NAME, consistency: 'strong' });
}

export type StableBrandKind = 'logo' | 'logo_alt' | 'favicon' | 'app_icon' | 'social';
export type BrandKind = StableBrandKind | 'hero';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STABLE_KEY_RE = new RegExp(`^brand/(${UUID})/(logo|logo_alt|favicon|app_icon|social)$`, 'i');
const HERO_KEY_RE   = new RegExp(`^brand/(${UUID})/hero/${UUID}$`, 'i');

export function brandKey(clientId: string, kind: StableBrandKind): string {
  return `brand/${clientId}/${kind}`;
}

export function heroKey(clientId: string, slideId: string): string {
  return `brand/${clientId}/hero/${slideId}`;
}

export function isAllowedBrandKey(key: string): boolean {
  return STABLE_KEY_RE.test(key) || HERO_KEY_RE.test(key);
}

/** True iff `key` is a valid brand key whose embedded client uuid equals clientId. */
export function keyBelongsToClient(key: string, clientId: string): boolean {
  // Both regexes capture the CLIENT uuid as group 1 (the hero regex leaves the
  // slide uuid uncaptured on purpose), so m[1] is always the client uuid.
  const m = STABLE_KEY_RE.exec(key) ?? HERO_KEY_RE.exec(key);
  return !!m && m[1]!.toLowerCase() === clientId.toLowerCase();
}

/** Magic-byte sniff (anti-spoof). Verbatim from POS v3. */
export function sniffImageMime(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

/**
 * Resolve a workspace slug to its client, WITHOUT any module-enablement gate.
 * Branding is module-agnostic — unlike _pub-authz.resolveStorefront which
 * requires POS + products to be enabled. Any workspace with a slug has a brand.
 */
export async function resolveClientBySlug(slug: string): Promise<{ clientId: string; name: string } | null> {
  if (!slug) return null;
  const sql = db();
  const rows = (await sql`
    SELECT id, name FROM public.clients WHERE slug = ${slug} LIMIT 1
  `) as Array<{ id: string; name: string }>;
  const c = rows[0];
  return c ? { clientId: c.id, name: c.name } : null;
}

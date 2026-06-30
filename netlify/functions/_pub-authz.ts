// Slug → tenant resolver + storefront-availability guard for the public
// (unauthenticated) storefront endpoints. Returns null for any reason a
// customer shouldn't be able to tell apart — unknown slug, storefront disabled,
// or the products/pos products not enabled — so handlers can map them all to a
// single 404 `storefront_unavailable` (anti-enumeration parity, spec §5.1/§8 Q8).

import { db } from './_shared/db';

export interface PubTenant {
  clientId: string;
  name: string;
}

export async function resolveStorefront(slug: string): Promise<PubTenant | null> {
  if (!slug) return null;
  const sql = db();
  const rows = (await sql`
    SELECT id, name, storefront_enabled
    FROM public.clients WHERE slug = ${slug} LIMIT 1
  `) as Array<{ id: string; name: string; storefront_enabled: boolean }>;
  const c = rows[0];
  if (!c || !c.storefront_enabled) return null;

  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products
    WHERE client_id = ${c.id}::uuid
  `) as Array<{ product_key: string }>;
  const set = new Set(enabled.map((e) => e.product_key));
  if (!set.has('products') || !set.has('pos')) return null;

  return { clientId: c.id, name: c.name };
}

// Shared current sellability rule for POS and public catalog readers.
// Each handler still owns its audience-specific gate, error precedence, and JSON shape.

import type { NeonQueryFunction } from '@neondatabase/serverless';

export type CatalogChannel = 'pos' | 'storefront' | 'catalog';

export interface CatalogCandidate {
  status: string;
  deleted_at: string | null;
  pos_visible: boolean;
  storefront_visible: boolean;
}

export interface CatalogMenuRow {
  id: string;
  name: string;
  category_id: string | null;
  sale_price_cents: number | string;
  hero_image_key: string | null;
}

export function isCatalogSellable(product: CatalogCandidate, channel: CatalogChannel): boolean {
  if (product.deleted_at || product.status !== 'active') return false;
  if (channel === 'pos') return product.pos_visible;
  if (channel === 'storefront') return product.storefront_visible;
  // Catalog Website's wider active-product rule is current wire behavior.
  // The approved Phase 1 policy changes it only in a dedicated consumer release.
  return true;
}

export async function loadCatalogMenuProducts(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  channel: CatalogChannel,
): Promise<CatalogMenuRow[]> {
  if (channel === 'pos') return (await sql`
    SELECT id, name, category_id, COALESCE(CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents END, price_cents) AS sale_price_cents, hero_image_key
    FROM public.products
    WHERE client_id = ${clientId}::uuid AND pos_visible = true AND deleted_at IS NULL AND status = 'active'
    ORDER BY category_id NULLS LAST, name
  `) as CatalogMenuRow[];
  if (channel === 'storefront') return (await sql`
    SELECT id, name, category_id, COALESCE(CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents END, price_cents) AS sale_price_cents, hero_image_key
    FROM public.products
    WHERE client_id = ${clientId}::uuid AND storefront_visible = true AND deleted_at IS NULL AND status = 'active'
    ORDER BY category_id NULLS LAST, name
  `) as CatalogMenuRow[];
  return (await sql`
    SELECT id, name, category_id, COALESCE(CASE WHEN sale_price_cents IS NOT NULL AND (sale_starts_at IS NULL OR sale_starts_at <= now()) AND (sale_ends_at IS NULL OR sale_ends_at > now()) THEN sale_price_cents END, price_cents) AS sale_price_cents, hero_image_key
    FROM public.products
    WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL AND status = 'active'
    ORDER BY category_id NULLS LAST, name
  `) as CatalogMenuRow[];
}

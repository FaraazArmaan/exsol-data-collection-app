// Catalog publication belongs to Product Manager. Operational modules request
// a policy transition instead of embedding direct products-table writes.

import type { NeonQueryFunction } from '@neondatabase/serverless';

export async function applyInventoryLifecyclePublicationPolicy(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  productId: string,
  lifecycleState: string,
): Promise<boolean> {
  if (lifecycleState !== 'discontinued') return false;
  const rows = (await sql`
    UPDATE public.products SET storefront_visible = false
    WHERE id = ${productId}::uuid AND client_id = ${clientId}::uuid AND storefront_visible = true
    RETURNING id
  `) as Array<{ id: string }>;
  return rows.length > 0;
}

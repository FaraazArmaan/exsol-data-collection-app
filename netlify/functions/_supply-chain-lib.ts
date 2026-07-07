import { type NeonQueryFunction } from '@neondatabase/serverless';

type SQL = NeonQueryFunction<false, false>;

type AlternateHint = { supplierId: string; supplierName: string; leadTimeDays: number };

/**
 * Returns the NON-primary product_suppliers row with the lowest lead_time_days for
 * the given product, or null if no alternate supplier exists.
 *
 * Used by GET /api/supply-chain-suppliers?product=<id> to surface a quick alternate hint.
 */
export async function suggestAlternate(
  sql: SQL,
  clientId: string,
  productId: string,
): Promise<AlternateHint | null> {
  const rows = (await sql`
    SELECT ps.supplier_id AS "supplierId",
           s.name AS "supplierName",
           ps.lead_time_days AS "leadTimeDays"
    FROM public.product_suppliers ps
    JOIN public.suppliers s ON s.id = ps.supplier_id AND s.deleted_at IS NULL
    WHERE ps.client_id = ${clientId}::uuid
      AND ps.product_id = ${productId}::uuid
      AND ps.is_primary = false
    ORDER BY ps.lead_time_days ASC
    LIMIT 1
  `) as Array<AlternateHint>;
  return rows[0] ?? null;
}

/**
 * Batch variant of suggestAlternate — fetches the lowest-lead-time non-primary supplier
 * for each product in one query.  Returns a Map keyed by product_id.
 *
 * Used by supply-chain-risk.ts to avoid N+1 calls when evaluating many flagged products.
 */
export async function batchSuggestAlternates(
  sql: SQL,
  clientId: string,
  productIds: string[],
): Promise<Map<string, AlternateHint>> {
  if (productIds.length === 0) return new Map();
  const rows = (await sql`
    SELECT DISTINCT ON (ps.product_id)
           ps.product_id AS "productId",
           ps.supplier_id AS "supplierId",
           s.name AS "supplierName",
           ps.lead_time_days AS "leadTimeDays"
    FROM public.product_suppliers ps
    JOIN public.suppliers s ON s.id = ps.supplier_id AND s.deleted_at IS NULL
    WHERE ps.client_id = ${clientId}::uuid
      AND ps.product_id::text = ANY(${productIds})
      AND ps.is_primary = false
    ORDER BY ps.product_id, ps.lead_time_days ASC
  `) as Array<AlternateHint & { productId: string }>;
  const map = new Map<string, AlternateHint>();
  for (const row of rows) {
    map.set(row.productId, {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      leadTimeDays: Number(row.leadTimeDays),
    });
  }
  return map;
}

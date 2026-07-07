import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';
import { ask } from './_shared/ai';

export const config = { path: '/api/supply-chain-brief', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const sql = db();

  // 1. Low-stock count
  const lowStockRows = (await sql`
    SELECT COUNT(*)::int AS cnt
    FROM public.inventory_stock
    WHERE client_id = ${clientId}::uuid
      AND qty_on_hand <= reorder_level
  `) as Array<{ cnt: number | string }>;
  const lowStockCount = Number(lowStockRows[0]?.cnt ?? 0);

  // 2. Open PO count + total value in cents
  const poRows = (await sql`
    SELECT COUNT(DISTINCT po.id)::int AS cnt,
           COALESCE(SUM(poi.qty * poi.unit_cost_cents), 0)::bigint AS total_cents
    FROM public.purchase_orders po
    LEFT JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
    WHERE po.client_id = ${clientId}::uuid
      AND po.status = 'ordered'
  `) as Array<{ cnt: number | string; total_cents: number | string }>;
  const openPoCount = Number(poRows[0]?.cnt ?? 0);
  const openPoValueCents = Number(poRows[0]?.total_cents ?? 0);

  // 3. In-progress production units
  const mfgRows = (await sql`
    SELECT COALESCE(SUM(qty), 0)::int AS units
    FROM public.production_orders
    WHERE client_id = ${clientId}::uuid
      AND status = 'in_progress'
  `) as Array<{ units: number | string }>;
  const unitsInProduction = Number(mfgRows[0]?.units ?? 0);

  // 4. Risk indicators: overdue POs and single-supplier products
  const tzRows = (await sql`
    SELECT timezone FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ timezone: string }>;
  const tz = tzRows[0]?.timezone ?? 'UTC';

  const overdueRows = (await sql`
    SELECT COUNT(*)::int AS cnt
    FROM public.purchase_orders
    WHERE client_id = ${clientId}::uuid
      AND status = 'ordered'
      AND expected_on < date_trunc('day', now() AT TIME ZONE ${tz})::date
  `) as Array<{ cnt: number | string }>;
  const overduePoCount = Number(overdueRows[0]?.cnt ?? 0);

  const singleSupRows = (await sql`
    WITH supplier_counts AS (
      SELECT ps.product_id, COUNT(ps.id)::int AS cnt
      FROM public.product_suppliers ps
      JOIN public.suppliers sup ON sup.id = ps.supplier_id AND sup.deleted_at IS NULL
      WHERE ps.client_id = ${clientId}::uuid
      GROUP BY ps.product_id
    )
    SELECT COUNT(*)::int AS cnt
    FROM public.products p
    LEFT JOIN supplier_counts sc ON sc.product_id = p.id
    WHERE p.client_id = ${clientId}::uuid
      AND p.type = 'physical'
      AND p.deleted_at IS NULL
      AND COALESCE(sc.cnt, 0) <= 1
  `) as Array<{ cnt: number | string }>;
  const singleSupplierCount = Number(singleSupRows[0]?.cnt ?? 0);

  // 5. 30-day CO2 total kg (using per-category factor, falling back to client default)
  const co2Rows = (await sql`
    SELECT COALESCE(SUM(poi.qty::numeric * COALESCE(
      (SELECT f2.kg_co2_per_unit
       FROM public.co2_emission_factors f2
       WHERE f2.client_id = ${clientId}::uuid
         AND f2.category_id = p.category_id
       LIMIT 1),
      (SELECT f3.kg_co2_per_unit
       FROM public.co2_emission_factors f3
       WHERE f3.client_id = ${clientId}::uuid
         AND f3.category_id IS NULL
       LIMIT 1),
      0
    )), 0) AS kg
    FROM public.purchase_orders po
    JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
    JOIN public.products p ON p.id = poi.product_id
    WHERE po.client_id = ${clientId}::uuid
      AND po.status IN ('ordered', 'received')
      AND po.expected_on >= (CURRENT_DATE - interval '29 days')
      AND po.expected_on <= CURRENT_DATE
  `) as Array<{ kg: string }>;
  const co2Kg30d = Math.round(Number(co2Rows[0]?.kg ?? 0) * 10) / 10;

  const aggregates = {
    lowStockProducts: lowStockCount,
    openPurchaseOrders: openPoCount,
    openPoValueCents,
    unitsInProduction,
    overduePos: overduePoCount,
    singleSupplierProducts: singleSupplierCount,
    co2Kg30d,
  };

  const system =
    'You are a supply-chain analyst. ' +
    'Summarize the current state of operations in 3-5 concise bullet points using only the numbers provided. ' +
    'Cite the exact figures. Keep it under 200 words. ' +
    'Money values are in cents (100 cents = $1). ' +
    'Do not add caveats about data completeness.';

  const prompt =
    'Supply-chain snapshot (all values are for the current client):\n' +
    JSON.stringify(aggregates, null, 2) +
    '\n\nWrite a brief narrative for the operations team.';

  const result = await ask({ system, prompt, maxTokens: 500 });

  return jsonOk({
    brief: result.text,
    model: result.model,
    fallback: result.fallback,
    generatedAt: new Date().toISOString(),
  });
}

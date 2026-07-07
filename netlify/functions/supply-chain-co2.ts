import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess, resolveSupplyChainWrite } from './_supply-chain-authz';

export const config = { path: '/api/supply-chain-co2' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

async function handleGet(req: Request): Promise<Response> {
  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;
  const sql = db();

  // factors: per-category rows + the null-category default
  const factorRows = (await sql`
    SELECT f.id,
           f.category_id AS "categoryId",
           pc.name AS "categoryName",
           f.kg_co2_per_unit AS "kgPerUnit"
    FROM public.co2_emission_factors f
    LEFT JOIN public.product_categories pc ON pc.id = f.category_id
    WHERE f.client_id = ${clientId}::uuid
    ORDER BY pc.name NULLS LAST
  `) as Array<{ id: string; categoryId: string | null; categoryName: string | null; kgPerUnit: string }>;

  const factors = factorRows.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    categoryName: r.categoryName ?? 'Default',
    kgPerUnit: Number(r.kgPerUnit),
  }));

  // Build a lookup map: categoryId (or 'default') → kgPerUnit
  const factorMap = new Map<string, number>();
  let defaultFactor = 0;
  for (const f of factors) {
    if (f.categoryId === null) {
      defaultFactor = f.kgPerUnit;
    } else {
      factorMap.set(f.categoryId, f.kgPerUnit);
    }
  }

  // byPo: per ordered/received PO, CO2 = sum(qty × factor)
  const poItemRows = (await sql`
    SELECT po.id AS "poId",
           s.name AS supplier,
           to_char(po.expected_on, 'YYYY-MM-DD') AS "expectedOn",
           poi.qty,
           p.category_id AS "categoryId"
    FROM public.purchase_orders po
    JOIN public.suppliers s ON s.id = po.supplier_id
    JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
    JOIN public.products p ON p.id = poi.product_id
    WHERE po.client_id = ${clientId}::uuid
      AND po.status IN ('ordered', 'received')
    ORDER BY po.expected_on DESC NULLS LAST, po.id
  `) as Array<{
    poId: string; supplier: string; expectedOn: string | null;
    qty: string; categoryId: string | null;
  }>;

  // Aggregate CO2 per PO
  const poMap = new Map<string, { supplier: string; expectedOn: string | null; kgCo2: number }>();
  for (const row of poItemRows) {
    const qty = Number(row.qty);
    const factor = row.categoryId !== null && factorMap.has(row.categoryId)
      ? factorMap.get(row.categoryId)!
      : defaultFactor;
    const co2 = qty * factor;
    const existing = poMap.get(row.poId);
    if (existing) {
      existing.kgCo2 += co2;
    } else {
      poMap.set(row.poId, { supplier: row.supplier, expectedOn: row.expectedOn, kgCo2: co2 });
    }
  }
  const byPo = Array.from(poMap.entries()).map(([poId, v]) => ({
    poId,
    supplier: v.supplier,
    expectedOn: v.expectedOn,
    kgCo2: Math.round(v.kgCo2 * 1000) / 1000,
  }));

  // trend: last 30 days bucketed by PO expected_on, zero-filled
  const trendRows = (await sql`
    SELECT to_char(po.expected_on, 'YYYY-MM-DD') AS day,
           sum(poi.qty::numeric * COALESCE(
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
           )) AS "kgCo2"
    FROM public.purchase_orders po
    JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
    JOIN public.products p ON p.id = poi.product_id
    WHERE po.client_id = ${clientId}::uuid
      AND po.status IN ('ordered', 'received')
      AND po.expected_on >= (CURRENT_DATE - interval '29 days')
      AND po.expected_on <= CURRENT_DATE
    GROUP BY to_char(po.expected_on, 'YYYY-MM-DD')
    ORDER BY day
  `) as Array<{ day: string; kgCo2: string }>;

  // Build a map of existing days
  const trendMap = new Map<string, number>();
  for (const r of trendRows) {
    trendMap.set(r.day, Math.round(Number(r.kgCo2) * 1000) / 1000);
  }

  // Zero-fill 30 days
  const trend: { day: string; kgCo2: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    trend.push({ day, kgCo2: trendMap.get(day) ?? 0 });
  }

  return jsonOk({ factors, byPo, trend });
}

async function handlePost(req: Request): Promise<Response> {
  const auth = await resolveSupplyChainWrite(req, 'supply-chain.products.edit');
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
  const { categoryId, kgPerUnit } = body as Record<string, unknown>;

  if (typeof kgPerUnit !== 'number' || kgPerUnit < 0) {
    return jsonError(400, 'invalid_kg_per_unit');
  }

  const sql = db();

  // Validate categoryId if provided
  if (categoryId !== null && categoryId !== undefined) {
    if (typeof categoryId !== 'string') return jsonError(400, 'invalid_category_id');
    const catCheck = (await sql`
      SELECT id FROM public.product_categories
      WHERE id = ${categoryId}::uuid AND client_id = ${clientId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `) as Array<{ id: string }>;
    if (catCheck.length === 0) return jsonError(404, 'category_not_found');
  }

  let rows: Array<{ id: string; categoryId: string | null; kgPerUnit: string }>;

  if (categoryId !== null && categoryId !== undefined) {
    // Upsert per-category factor (partial unique index: category_id IS NOT NULL)
    rows = (await sql`
      INSERT INTO public.co2_emission_factors (client_id, category_id, kg_co2_per_unit)
      VALUES (${clientId}::uuid, ${categoryId as string}::uuid, ${kgPerUnit}::numeric)
      ON CONFLICT (client_id, category_id) WHERE category_id IS NOT NULL DO UPDATE
        SET kg_co2_per_unit = EXCLUDED.kg_co2_per_unit
      RETURNING id, category_id AS "categoryId", kg_co2_per_unit AS "kgPerUnit"
    `) as Array<{ id: string; categoryId: string | null; kgPerUnit: string }>;
  } else {
    // Upsert client default (partial unique index: category_id IS NULL)
    rows = (await sql`
      INSERT INTO public.co2_emission_factors (client_id, category_id, kg_co2_per_unit)
      VALUES (${clientId}::uuid, NULL, ${kgPerUnit}::numeric)
      ON CONFLICT (client_id) WHERE category_id IS NULL DO UPDATE
        SET kg_co2_per_unit = EXCLUDED.kg_co2_per_unit
      RETURNING id, category_id AS "categoryId", kg_co2_per_unit AS "kgPerUnit"
    `) as Array<{ id: string; categoryId: string | null; kgPerUnit: string }>;
  }

  const row = rows[0]!;
  return jsonOk({ id: row.id, categoryId: row.categoryId, kgPerUnit: Number(row.kgPerUnit) }, { status: 201 });
}

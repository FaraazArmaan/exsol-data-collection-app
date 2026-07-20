// POST /api/manufacturing/qc-result — record a QC check outcome.
// Body: { id, result: pass|fail, disposition?: none|scrap|rework, scrap_qty?, notes? }.
// disposition='scrap' with scrap_qty>0 removes defective OUTPUT units from stock via
// a type='adjustment' movement (guarded by the qty_on_hand>=0 CHECK); 'rework' just
// records the decision. (manufacturing.products.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/qc-result', method: 'POST' };

const RESULTS = new Set(['pass', 'fail']);
const DISPOSITIONS = new Set(['none', 'scrap', 'rework']);

interface Body { id?: unknown; result?: unknown; disposition?: unknown; scrap_qty?: unknown; notes?: unknown }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireManufacturing(req, ['manufacturing.products.edit']);
  if (!a.ok) return a.res;

  let body: Body;
  try { body = (await req.json()) as Body; } catch { return jsonError(400, 'invalid_json'); }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const result = typeof body.result === 'string' ? body.result.trim() : '';
  const disposition = typeof body.disposition === 'string' ? body.disposition.trim() : 'none';
  const scrapQty = typeof body.scrap_qty === 'number' ? Math.max(0, Math.trunc(body.scrap_qty)) : 0;
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  if (!id) return jsonError(400, 'id_required');
  if (!RESULTS.has(result)) return jsonError(400, 'result_invalid');
  if (!DISPOSITIONS.has(disposition)) return jsonError(400, 'disposition_invalid');

  const sql = db();
  const rows = (await sql`
    SELECT qc.id, b.output_product_id
    FROM public.manufacturing_qc_checks qc
    JOIN public.production_orders po ON po.id = qc.production_order_id
    JOIN public.boms b ON b.id = po.bom_id
    WHERE qc.id = ${id}::uuid AND qc.client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; output_product_id: string }>;
  if (rows.length === 0) return jsonError(404, 'not_found');
  const outputId = rows[0]!.output_product_id;

  const doScrap = disposition === 'scrap' && scrapQty > 0;

  if (doScrap) {
    // Pre-check available output stock; the qty>=0 CHECK is the concurrency backstop.
    const stock = (await sql`
      SELECT qty_on_hand FROM public.inventory_stock
      WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ${outputId}::uuid AND variant_id IS NULL LIMIT 1
    `) as Array<{ qty_on_hand: number }>;
    if ((stock[0]?.qty_on_hand ?? 0) < scrapQty) return jsonError(400, 'insufficient_stock');
  }

  const queries = [];
  if (doScrap) {
    queries.push(sql`
      UPDATE public.inventory_stock SET qty_on_hand = qty_on_hand - ${scrapQty}::int, updated_at = now()
      WHERE client_id = ${a.ctx.clientId}::uuid AND product_id = ${outputId}::uuid AND variant_id IS NULL
    `);
    queries.push(sql`
      INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${outputId}::uuid, ${-scrapQty}::int, 'adjustment', ${`qc-scrap:${id}`}, ${a.ctx.userNodeId}::uuid)
    `);
  }
  queries.push(sql`
    UPDATE public.manufacturing_qc_checks
    SET result = ${result}, disposition = ${disposition}, scrap_qty = ${doScrap ? scrapQty : 0}::int,
        notes = ${notes}, updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `);

  try {
    await sql.transaction(queries);
  } catch (e) {
    if ((e as { code?: string }).code === '23514') return jsonError(400, 'insufficient_stock');
    throw e;
  }

  const updated = (await sql`
    SELECT id, production_order_id, item, result, disposition, scrap_qty, notes, created_at
    FROM public.manufacturing_qc_checks WHERE id = ${id}::uuid LIMIT 1
  `) as Array<Record<string, unknown>>;
  return jsonOk({ check: updated[0] });
}

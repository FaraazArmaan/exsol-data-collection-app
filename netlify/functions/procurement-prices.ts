// /api/procurement/prices — per-supplier per-product price list + history (GET)
// and set-price (POST, append-only). Current price = latest effective_from<=today.
//   GET ?supplier_id=            → { prices } (current price per product)
//   GET ?supplier_id=&product_id= → { history } (all rows for the pair, newest first)
//   POST { supplier_id, product_id, unit_cost_cents, effective_from? } → appends
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/prices', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    const url = new URL(req.url);
    const supplierId = (url.searchParams.get('supplier_id') ?? '').trim();
    const productId = (url.searchParams.get('product_id') ?? '').trim();
    if (!UUID_RE.test(supplierId)) return jsonError(400, 'supplier_id_required');
    const sql = db();

    if (productId) {
      if (!UUID_RE.test(productId)) return jsonError(400, 'invalid_product');
      const history = (await sql`
        SELECT id, unit_cost_cents, to_char(effective_from, 'YYYY-MM-DD') AS effective_from
        FROM public.supplier_prices
        WHERE client_id = ${a.ctx.clientId}::uuid AND supplier_id = ${supplierId}::uuid AND product_id = ${productId}::uuid
        ORDER BY effective_from DESC, created_at DESC
      `) as unknown[];
      return jsonOk({ history });
    }

    const prices = (await sql`
      SELECT product_id, product_name, unit_cost_cents, effective_from FROM (
        SELECT DISTINCT ON (sp.product_id) sp.product_id, p.name AS product_name, sp.unit_cost_cents,
               to_char(sp.effective_from, 'YYYY-MM-DD') AS effective_from
        FROM public.supplier_prices sp
        JOIN public.products p ON p.id = sp.product_id
        WHERE sp.client_id = ${a.ctx.clientId}::uuid AND sp.supplier_id = ${supplierId}::uuid
          AND p.deleted_at IS NULL AND sp.effective_from <= current_date
        ORDER BY sp.product_id, sp.effective_from DESC, sp.created_at DESC
      ) t
      ORDER BY product_name ASC
    `) as unknown[];
    return jsonOk({ prices });
  }

  if (req.method === 'POST') {
    const a = await requireProcurement(req, ['procurement.products.edit']);
    if (!a.ok) return a.res;
    let body: { supplier_id?: unknown; product_id?: unknown; unit_cost_cents?: unknown; effective_from?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const supplierId = typeof body.supplier_id === 'string' ? body.supplier_id.trim() : '';
    const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
    const cost = typeof body.unit_cost_cents === 'number' ? Math.trunc(body.unit_cost_cents) : NaN;
    const effectiveFrom = typeof body.effective_from === 'string' && body.effective_from.trim() !== ''
      ? body.effective_from.trim() : null;
    if (!UUID_RE.test(supplierId)) return jsonError(400, 'supplier_id_required');
    if (!UUID_RE.test(productId)) return jsonError(400, 'product_id_required');
    if (!Number.isFinite(cost) || cost < 0) return jsonError(400, 'invalid_cost');
    if (effectiveFrom !== null && !DATE_RE.test(effectiveFrom)) return jsonError(400, 'invalid_date');

    const sql = db();
    const ok = (await sql`
      SELECT
        (SELECT 1 FROM public.suppliers WHERE id = ${supplierId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL) AS sup,
        (SELECT 1 FROM public.products  WHERE id = ${productId}::uuid  AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL) AS prod
    `) as Array<{ sup: number | null; prod: number | null }>;
    if (!ok[0]?.sup) return jsonError(404, 'supplier_not_found');
    if (!ok[0]?.prod) return jsonError(404, 'product_not_found');

    const rows = (await sql`
      INSERT INTO public.supplier_prices (client_id, supplier_id, product_id, unit_cost_cents, effective_from, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${supplierId}::uuid, ${productId}::uuid, ${cost}::bigint,
              COALESCE(${effectiveFrom}::date, current_date), ${a.ctx.userNodeId}::uuid)
      RETURNING to_char(effective_from, 'YYYY-MM-DD') AS effective_from
    `) as Array<{ effective_from: string }>;
    return jsonOk({ ok: true, effective_from: rows[0]!.effective_from }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}

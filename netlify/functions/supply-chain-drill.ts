import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';

export const config = { path: '/api/supply-chain-drill', method: 'GET' };

const VALID_TYPES = ['product-movements', 'po-items', 'production-bom'] as const;
type DrillType = (typeof VALID_TYPES)[number];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const params = new URL(req.url).searchParams;
  const type = params.get('type');
  const id = params.get('id');

  if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
    return jsonError(400, 'invalid_type');
  }
  if (!id || !UUID_RE.test(id)) {
    return jsonError(400, 'invalid_id');
  }

  const sql = db();

  if ((type as DrillType) === 'product-movements') {
    const rows = (await sql`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
             type,
             qty_delta AS "qtyDelta",
             ref
      FROM public.stock_movements
      WHERE product_id = ${id}::uuid
        AND client_id = ${clientId}::uuid
      ORDER BY created_at DESC
      LIMIT 20
    `) as Array<{ date: string; type: string; qtyDelta: number | string; ref: string | null }>;
    return jsonOk({
      rows: rows.map((r) => ({
        date: r.date,
        type: r.type,
        qtyDelta: Number(r.qtyDelta),
        ref: r.ref,
      })),
    });
  }

  if ((type as DrillType) === 'po-items') {
    const rows = (await sql`
      SELECT p.name AS product,
             poi.qty,
             poi.unit_cost_cents AS "unitCostCents",
             (poi.qty * poi.unit_cost_cents) AS "lineTotalCents"
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
      JOIN public.products p ON p.id = poi.product_id AND p.deleted_at IS NULL
      WHERE poi.purchase_order_id = ${id}::uuid
        AND po.client_id = ${clientId}::uuid
    `) as Array<{
      product: string;
      qty: number | string;
      unitCostCents: number | string;
      lineTotalCents: number | string;
    }>;
    return jsonOk({
      rows: rows.map((r) => ({
        product: r.product,
        qty: Number(r.qty),
        unitCostCents: Number(r.unitCostCents),
        lineTotalCents: Number(r.lineTotalCents),
      })),
    });
  }

  // type === 'production-bom'
  const rows = (await sql`
    SELECT p.name AS component,
           bc.qty
    FROM public.bom_components bc
    JOIN public.production_orders prod ON prod.bom_id = bc.bom_id
    JOIN public.products p ON p.id = bc.component_product_id AND p.deleted_at IS NULL
    WHERE prod.id = ${id}::uuid
      AND prod.client_id = ${clientId}::uuid
  `) as Array<{ component: string; qty: number | string }>;
  return jsonOk({
    rows: rows.map((r) => ({ component: r.component, qty: Number(r.qty) })),
  });
}

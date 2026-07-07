// GET /api/procurement/spend — committed spend analytics over the last 6 months.
// Spend = sum(qty × unit_cost) over ordered/received POs, grouped by supplier,
// by product category, and by month. All amounts coerced to numbers.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/spend', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireProcurement(req, ['procurement.products.view']);
  if (!a.ok) return a.res;

  const cid = a.ctx.clientId;
  const sql = db();

  const bySupplier = (await sql`
    SELECT s.name, sum(poi.qty * poi.unit_cost_cents)::bigint AS total_cents
    FROM public.purchase_orders po
    JOIN public.suppliers s ON s.id = po.supplier_id
    JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
    WHERE po.client_id = ${cid}::uuid AND po.status IN ('ordered', 'received')
      AND po.created_at >= now() - interval '6 months'
    GROUP BY s.id, s.name
    ORDER BY total_cents DESC
    LIMIT 12
  `) as Array<{ name: string; total_cents: string }>;

  const byCategory = (await sql`
    SELECT coalesce(c.name, 'Uncategorised') AS name, sum(poi.qty * poi.unit_cost_cents)::bigint AS total_cents
    FROM public.purchase_orders po
    JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
    JOIN public.products p ON p.id = poi.product_id
    LEFT JOIN public.product_categories c ON c.id = p.category_id
    WHERE po.client_id = ${cid}::uuid AND po.status IN ('ordered', 'received')
      AND po.created_at >= now() - interval '6 months'
    GROUP BY coalesce(c.name, 'Uncategorised')
    ORDER BY total_cents DESC
    LIMIT 12
  `) as Array<{ name: string; total_cents: string }>;

  const overTime = (await sql`
    SELECT to_char(date_trunc('month', po.created_at), 'YYYY-MM') AS month,
           sum(poi.qty * poi.unit_cost_cents)::bigint AS total_cents
    FROM public.purchase_orders po
    JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
    WHERE po.client_id = ${cid}::uuid AND po.status IN ('ordered', 'received')
      AND po.created_at >= now() - interval '6 months'
    GROUP BY date_trunc('month', po.created_at)
    ORDER BY date_trunc('month', po.created_at) ASC
  `) as Array<{ month: string; total_cents: string }>;

  const num = (rows: Array<{ name?: string; month?: string; total_cents: string }>) =>
    rows.map((r) => ({ ...r, total_cents: Number(r.total_cents) }));

  return jsonOk({
    bySupplier: num(bySupplier),
    byCategory: num(byCategory),
    overTime: overTime.map((r) => ({ month: r.month, total_cents: Number(r.total_cents) })),
  });
}

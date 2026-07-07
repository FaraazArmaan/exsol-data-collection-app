// GET /api/manufacturing/bom-cost/:id — cost rollup for a BOM: each component's
// unit cost × qty, plus the assembled total. Components without a set cost roll up
// as 0. (manufacturing.products.view)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/bom-cost/:id', method: 'GET' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');
  const a = await requireManufacturing(req, ['manufacturing.products.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const bom = (await sql`
    SELECT id FROM public.boms WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ id: string }>;
  if (bom.length === 0) return jsonError(404, 'not_found');

  const rows = (await sql`
    SELECT bc.component_product_id AS product_id, p.name AS product_name, bc.qty,
           coalesce(c.unit_cost_cents, 0) AS unit_cost_cents,
           (bc.qty * coalesce(c.unit_cost_cents, 0)) AS line_cents
    FROM public.bom_components bc
    JOIN public.products p ON p.id = bc.component_product_id
    LEFT JOIN public.manufacturing_product_costs c
      ON c.product_id = bc.component_product_id AND c.client_id = ${a.ctx.clientId}::uuid
    WHERE bc.bom_id = ${id}::uuid
    ORDER BY p.name ASC
  `) as Array<{ product_id: string; product_name: string; qty: number; unit_cost_cents: string; line_cents: string }>;

  const components = rows.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    qty: r.qty,
    unit_cost_cents: Number(r.unit_cost_cents),
    line_cents: Number(r.line_cents),
  }));
  const total_cents = components.reduce((s, c) => s + c.line_cents, 0);

  return jsonOk({ bom_id: id, components, total_cents });
}

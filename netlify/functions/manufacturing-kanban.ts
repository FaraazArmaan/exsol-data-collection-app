// GET /api/manufacturing/kanban — production orders as a board: every order with
// its lane (status), within-lane order (board_rank), priority and due date, joined
// to the output product. The FE groups by status. (manufacturing.products.view)
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/kanban', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireManufacturing(req, ['manufacturing.products.view']);
  if (!a.ok) return a.res;
  const sql = db();
  const items = (await sql`
    SELECT po.id, po.bom_id, b.name AS bom_name, b.output_product_id,
           p.name AS output_product_name, po.qty, po.status,
           po.board_rank, po.priority, to_char(po.due_on, 'YYYY-MM-DD') AS due_on,
           po.created_at
    FROM public.production_orders po
    JOIN public.boms b ON b.id = po.bom_id
    JOIN public.products p ON p.id = b.output_product_id
    WHERE po.client_id = ${a.ctx.clientId}::uuid
    ORDER BY po.status ASC, po.board_rank ASC, po.created_at DESC
  `) as unknown[];
  return jsonOk({ items });
}

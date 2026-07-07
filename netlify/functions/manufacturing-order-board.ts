// POST /api/manufacturing/order-board — update a card's board fields (rank within a
// lane, priority, due date). Lane MOVES (status changes) go through order-advance,
// which owns the consume/produce on completion; this only touches presentation +
// scheduling fields. (manufacturing.products.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/order-board', method: 'POST' };

const PRIORITIES = new Set(['low', 'normal', 'high']);

interface Body {
  id?: unknown;
  board_rank?: unknown;
  priority?: unknown;
  due_on?: unknown;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireManufacturing(req, ['manufacturing.products.edit']);
  if (!a.ok) return a.res;

  let body: Body;
  try { body = (await req.json()) as Body; } catch { return jsonError(400, 'invalid_json'); }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return jsonError(400, 'id_required');

  const rank = typeof body.board_rank === 'number' ? Math.trunc(body.board_rank) : null;
  const priority = typeof body.priority === 'string' ? body.priority.trim() : null;
  const dueOn = typeof body.due_on === 'string' && body.due_on.trim() ? body.due_on.trim() : null;
  const clearDue = body.due_on === null; // explicit null clears the date
  if (priority !== null && !PRIORITIES.has(priority)) return jsonError(400, 'priority_invalid');

  const sql = db();
  const rows = (await sql`
    UPDATE public.production_orders SET
      board_rank = COALESCE(${rank}::int, board_rank),
      priority = COALESCE(${priority}, priority),
      due_on = CASE WHEN ${clearDue} THEN NULL ELSE COALESCE(${dueOn}::date, due_on) END,
      updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id, board_rank, priority, to_char(due_on, 'YYYY-MM-DD') AS due_on
  `) as Array<Record<string, unknown>>;
  if (rows.length === 0) return jsonError(404, 'not_found');
  return jsonOk({ order: rows[0] });
}

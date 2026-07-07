// GET   /api/hr/checklist-instance?id= — one instance + its items.
// PATCH /api/hr/checklist-instance?id= — { action:'toggle-item', item_id, done }
//        | { action:'complete' } | { action:'reopen' }.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireHr } from './_hr-authz';

export const config = { path: '/api/hr/checklist-instance' };

export default async function handler(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return jsonError(400, 'id_required');

  if (req.method === 'GET') {
    const a = await requireHr(req, ['hr.employees.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT id, kind, subject_user_node_id, subject_name, status, created_at, completed_at
      FROM public.hr_checklist_instances
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<Record<string, unknown>>;
    if (!rows[0]) return jsonError(404, 'not_found');
    const items = (await sql`
      SELECT id, position, label, description, action_hint, done, done_at
      FROM public.hr_checklist_instance_items
      WHERE instance_id = ${id}::uuid ORDER BY position
    `) as unknown[];
    return jsonOk({ instance: rows[0], items });
  }

  if (req.method === 'PATCH') {
    const a = await requireHr(req, ['hr.employees.edit']);
    if (!a.ok) return a.res;
    let body: { action?: unknown; item_id?: unknown; done?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return jsonError(400, 'invalid_body'); }
    const sql = db();

    // Guard: instance belongs to caller's client.
    const own = (await sql`
      SELECT 1 FROM public.hr_checklist_instances
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as unknown[];
    if (!own[0]) return jsonError(404, 'not_found');

    const action = String(body.action ?? '');
    if (action === 'toggle-item') {
      const itemId = body.item_id ? String(body.item_id) : '';
      const done = body.done === true;
      if (!itemId) return jsonError(400, 'item_id_required');
      const upd = (await sql`
        UPDATE public.hr_checklist_instance_items
        SET done = ${done},
            done_at = ${done ? new Date().toISOString() : null}::timestamptz,
            done_by_user_node = ${done ? a.ctx.userNodeId : null}
        WHERE id = ${itemId}::uuid AND instance_id = ${id}::uuid
        RETURNING id
      `) as Array<{ id: string }>;
      if (!upd[0]) return jsonError(404, 'item_not_found');
      return jsonOk({ ok: true });
    }
    if (action === 'complete') {
      await sql`
        UPDATE public.hr_checklist_instances
        SET status = 'completed', completed_at = now() WHERE id = ${id}::uuid
      `;
      return jsonOk({ ok: true, status: 'completed' });
    }
    if (action === 'reopen') {
      await sql`
        UPDATE public.hr_checklist_instances
        SET status = 'open', completed_at = NULL WHERE id = ${id}::uuid
      `;
      return jsonOk({ ok: true, status: 'open' });
    }
    return jsonError(400, 'invalid_action');
  }

  return jsonError(405, 'method_not_allowed');
}

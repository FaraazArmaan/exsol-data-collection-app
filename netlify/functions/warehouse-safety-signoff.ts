// POST /api/warehouse/safety-signoff — sign off a recurring checklist for this cycle.
// Body: { checklist_id, notes? }. Appends a signoff row (the checklist's "last
// completed"), which clears its due status. (warehouse.business.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/safety-signoff', method: 'POST' };

interface Body { checklist_id?: unknown; notes?: unknown }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.business.edit']);
  if (!a.ok) return a.res;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const checklistId = typeof body.checklist_id === 'string' ? body.checklist_id.trim() : '';
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  if (!checklistId) return jsonError(400, 'checklist_id_required');

  const sql = db();
  const chk = (await sql`
    SELECT id FROM public.safety_checklists
    WHERE id = ${checklistId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as Array<{ id: string }>;
  if (chk.length === 0) return jsonError(404, 'checklist_not_found');

  const rows = (await sql`
    INSERT INTO public.safety_checklist_signoffs (checklist_id, signed_by, notes)
    VALUES (${checklistId}::uuid, ${a.ctx.userNodeId}::uuid, ${notes})
    RETURNING id, signed_at
  `) as Array<{ id: string; signed_at: string }>;
  return jsonOk({ signoff: rows[0] });
}

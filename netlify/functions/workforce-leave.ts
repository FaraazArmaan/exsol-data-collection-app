// /api/workforce/leave/:id
//   PATCH  → approve or deny a pending leave request (workforce.leave.edit)
//   DELETE → hard delete a pending leave request (workforce.leave.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { recordApprovalDecision, requireApprovalOwner } from './_workforce-approval-routing';

export const config = { path: '/api/workforce/leave/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/workforce\/leave\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

interface PatchBody {
  action?: unknown;
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.leave.edit']);
  if (!a.ok) return a.res;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (action !== 'approve' && action !== 'deny') {
    return jsonError(400, 'invalid_action');
  }

  const sql = db();

  // Fetch existing — client-scoped.
  const existing = (await sql`
    SELECT id, status, user_node_id FROM public.leave_requests
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string; user_node_id: string | null }>;
  if (existing.length === 0) return jsonError(404, 'request_not_found');
  if (existing[0]!.status !== 'pending') return jsonError(409, 'already_handled');
  const routing = await requireApprovalOwner(a.ctx, 'leave', existing[0]!.user_node_id);
  if (routing instanceof Response) return routing;

  const newStatus = action === 'approve' ? 'approved' : 'denied';

  const rows = (await sql`
    WITH upd AS (
      UPDATE public.leave_requests
      SET
        status     = ${newStatus},
        handled_by = ${a.ctx.userNodeId}::uuid,
        handled_at = now(),
        updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING *
    )
    SELECT
      lr.id,
      lr.resource_id,
      br.name AS resource_name,
      lr.user_node_id,
      lr.leave_type,
      to_char(lr.start_date, 'YYYY-MM-DD') AS start_date,
      to_char(lr.end_date,   'YYYY-MM-DD') AS end_date,
      lr.notes,
      lr.status,
      lr.handled_by,
      lr.handled_at,
      lr.created_at
    FROM upd lr
    JOIN public.booking_resources br ON br.id = lr.resource_id
  `) as Array<Record<string, unknown>>;

  if (rows.length === 0) return jsonError(404, 'request_not_found');
  await recordApprovalDecision(a.ctx, 'leave', id, routing.ownerUserNodeId, newStatus);
  return jsonOk({ request: rows[0] });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.leave.delete']);
  if (!a.ok) return a.res;

  const sql = db();

  const existing = (await sql`
    SELECT id, status FROM public.leave_requests
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string }>;
  if (existing.length === 0) return jsonError(404, 'request_not_found');
  if (existing[0]!.status !== 'pending') return jsonError(409, 'cannot_delete_handled');

  await sql`
    DELETE FROM public.leave_requests
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `;
  return new Response(null, { status: 204 });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'PATCH') return handlePatch(req, id);
  if (req.method === 'DELETE') return handleDelete(req, id);
  return jsonError(405, 'method_not_allowed');
}

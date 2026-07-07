// /api/workforce/overtime/:id
//   PATCH  → approve or deny (workforce.employees.edit)
//   DELETE → remove entry (workforce.employees.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/overtime/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/\/overtime\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;

  let body: { action?: unknown };
  try {
    body = (await req.json()) as { action?: unknown };
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const action = typeof body.action === 'string' ? body.action : '';
  if (action !== 'approve' && action !== 'deny') {
    return jsonError(400, 'action_must_be_approve_or_deny');
  }

  const sql = db();

  const existing = (await sql`
    SELECT id, status FROM public.overtime_entries
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string }>;
  if (existing.length === 0) return jsonError(404, 'overtime_not_found');
  if (existing[0]!.status !== 'pending') return jsonError(409, 'already_handled');

  const newStatus = action === 'approve' ? 'approved' : 'denied';

  const rows = (await sql`
    UPDATE public.overtime_entries
    SET
      status     = ${newStatus}::text,
      handled_by = ${a.ctx.userNodeId}::uuid,
      handled_at = now(),
      updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING
      id, resource_id, user_node_id, punch_id,
      to_char(ot_date, 'YYYY-MM-DD') AS ot_date,
      ot_hours, reason, status, handled_by, handled_at, created_at
  `) as Array<Record<string, unknown>>;

  if (rows.length === 0) return jsonError(404, 'overtime_not_found');
  return jsonOk({ entry: rows[0] });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.delete']);
  if (!a.ok) return a.res;

  const sql = db();

  const existing = (await sql`
    SELECT id FROM public.overtime_entries
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing.length === 0) return jsonError(404, 'overtime_not_found');

  await sql`
    DELETE FROM public.overtime_entries
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

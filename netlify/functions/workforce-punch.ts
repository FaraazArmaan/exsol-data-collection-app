// /api/workforce/punch/:id
//   PATCH  → clock out (workforce.employees.edit)
//   DELETE → hard delete (workforce.employees.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/punch/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/workforce\/punch\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;

  const sql = db();

  const existing = (await sql`
    SELECT id, punched_out_at FROM public.workforce_punches
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; punched_out_at: string | null }>;
  if (existing.length === 0) return jsonError(404, 'punch_not_found');
  if (existing[0]!.punched_out_at !== null) return jsonError(409, 'already_clocked_out');

  const rows = (await sql`
    UPDATE public.workforce_punches
    SET punched_out_at = now(), updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING
      id, resource_id, user_node_id, shift_id,
      punched_in_at, punched_out_at, late_minutes, is_absent, notes, created_at
  `) as Array<Record<string, unknown>>;

  if (rows.length === 0) return jsonError(404, 'punch_not_found');
  return jsonOk({ punch: rows[0] });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.delete']);
  if (!a.ok) return a.res;

  const sql = db();

  const existing = (await sql`
    SELECT id FROM public.workforce_punches
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing.length === 0) return jsonError(404, 'punch_not_found');

  await sql`
    DELETE FROM public.workforce_punches
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

// /api/workforce/shift/:id — DELETE
// Removes a shift. Verifies client ownership before deletion.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/shift/:id' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'DELETE') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforce(req, ['workforce.employees.delete']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const id = url.pathname.split('/').at(-1) ?? '';

  const sql = db();
  const rows = (await sql`
    DELETE FROM public.workforce_shifts
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id
  `) as Array<{ id: string }>;
  if (!rows.length) return jsonError(404, 'shift_not_found');

  return new Response(null, { status: 204 });
}

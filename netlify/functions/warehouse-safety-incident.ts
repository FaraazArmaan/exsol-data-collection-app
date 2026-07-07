// /api/warehouse/safety-incident/:id
//   PATCH  → open/close (or edit) an incident (warehouse.business.edit)
//   DELETE → remove an incident (warehouse.business.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/safety-incident/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['open', 'closed']);

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/safety-incident\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

interface PatchBody { status?: unknown; title?: unknown; description?: unknown }

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.edit']);
  if (!a.ok) return a.res;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const status = typeof body.status === 'string' ? body.status.trim() : undefined;
  const title = typeof body.title === 'string' ? body.title.trim() : undefined;
  const description = typeof body.description === 'string' ? body.description.trim() : undefined;
  if (status !== undefined && !STATUSES.has(status)) return jsonError(400, 'status_invalid');
  if (title !== undefined && !title) return jsonError(400, 'title_required');

  const sql = db();
  const rows = (await sql`
    UPDATE public.safety_incidents SET
      status = COALESCE(${status ?? null}, status),
      title = COALESCE(${title ?? null}, title),
      description = COALESCE(${description ?? null}, description),
      updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, severity, status, title, description, location_id, created_at
  `) as Array<Record<string, unknown>>;
  if (rows.length === 0) return jsonError(404, 'not_found');
  return jsonOk({ incident: rows[0] });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.delete']);
  if (!a.ok) return a.res;
  const sql = db();
  const rows = (await sql`
    DELETE FROM public.safety_incidents
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id
  `) as Array<{ id: string }>;
  if (rows.length === 0) return jsonError(404, 'not_found');
  return new Response(null, { status: 204 });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'PATCH') return handlePatch(req, id);
  if (req.method === 'DELETE') return handleDelete(req, id);
  return jsonError(405, 'method_not_allowed');
}

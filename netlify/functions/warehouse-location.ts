// /api/warehouse/location/:id
//   PATCH  → rename / re-kind a location (warehouse.business.edit)
//   DELETE → remove a location; its stock_by_location rows cascade (warehouse.business.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';
import { LOCATION_KINDS } from './warehouse-locations';

export const config = { path: '/api/warehouse/location/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/warehouse\/location\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

interface PatchBody {
  name?: unknown;
  kind?: unknown;
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.edit']);
  if (!a.ok) return a.res;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const kind = typeof body.kind === 'string' ? body.kind.trim() : undefined;
  if (name !== undefined && !name) return jsonError(400, 'name_required');
  if (kind !== undefined && !(LOCATION_KINDS as readonly string[]).includes(kind)) {
    return jsonError(400, 'kind_invalid');
  }
  if (name === undefined && kind === undefined) return jsonError(400, 'nothing_to_update');

  const sql = db();
  try {
    const rows = (await sql`
      UPDATE public.warehouse_locations
      SET name = COALESCE(${name ?? null}, name),
          kind = COALESCE(${kind ?? null}, kind),
          updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, name, kind, created_at
    `) as Array<Record<string, unknown>>;
    if (rows.length === 0) return jsonError(404, 'location_not_found');
    return jsonOk({ location: rows[0] });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return jsonError(409, 'name_taken');
    throw e;
  }
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.delete']);
  if (!a.ok) return a.res;
  const sql = db();
  const rows = (await sql`
    DELETE FROM public.warehouse_locations
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id
  `) as Array<{ id: string }>;
  if (rows.length === 0) return jsonError(404, 'location_not_found');
  return new Response(null, { status: 204 });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'PATCH') return handlePatch(req, id);
  if (req.method === 'DELETE') return handleDelete(req, id);
  return jsonError(405, 'method_not_allowed');
}

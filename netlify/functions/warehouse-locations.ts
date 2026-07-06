// /api/warehouse/locations
//   GET  → list the caller's stock locations (warehouse.business.view)
//   POST → create a location { name, kind } (warehouse.business.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/locations' };

export const LOCATION_KINDS = ['warehouse', 'store', 'storage', 'other'] as const;

interface CreateBody {
  name?: unknown;
  kind?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.view']);
  if (!a.ok) return a.res;
  const sql = db();
  const rows = (await sql`
    SELECT id, name, kind, created_at
    FROM public.warehouse_locations
    WHERE client_id = ${a.ctx.clientId}::uuid
    ORDER BY name ASC
  `) as unknown[];
  return jsonOk({ locations: rows });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.create']);
  if (!a.ok) return a.res;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const kind = typeof body.kind === 'string' && body.kind.trim() ? body.kind.trim() : 'warehouse';
  if (!name) return jsonError(400, 'name_required');
  if (!(LOCATION_KINDS as readonly string[]).includes(kind)) return jsonError(400, 'kind_invalid');

  const sql = db();
  try {
    const rows = (await sql`
      INSERT INTO public.warehouse_locations (client_id, name, kind)
      VALUES (${a.ctx.clientId}::uuid, ${name}, ${kind})
      RETURNING id, name, kind, created_at
    `) as Array<Record<string, unknown>>;
    return jsonOk({ location: rows[0] }, { status: 201 });
  } catch (e) {
    // (client_id, name) unique — surface a friendly conflict rather than a 500.
    if ((e as { code?: string }).code === '23505') return jsonError(409, 'name_taken');
    throw e;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

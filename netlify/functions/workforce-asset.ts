// /api/workforce/asset/:id
//   PATCH  → update asset (workforce.assets.edit)
//   DELETE → soft delete — condition → 'retired' (workforce.assets.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/asset/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CONDITIONS = ['good', 'fair', 'poor', 'retired'] as const;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/\/asset\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

interface PatchAssetBody {
  name?: unknown;
  description?: unknown;
  serial_number?: unknown;
  condition?: unknown;
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.edit']);
  if (!a.ok) return a.res;

  let body: PatchAssetBody;
  try {
    body = (await req.json()) as PatchAssetBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const sql = db();

  const existing = (await sql`
    SELECT id, name, description, serial_number, condition
    FROM public.workforce_assets
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; name: string; description: string | null; serial_number: string | null; condition: string }>;
  if (existing.length === 0) return jsonError(404, 'asset_not_found');

  const cur = existing[0]!;

  const name =
    typeof body.name === 'string' ? body.name.trim() || cur.name : cur.name;
  const description =
    body.description !== undefined
      ? (typeof body.description === 'string' ? body.description.trim() || null : null)
      : cur.description;
  const serialNumber =
    body.serial_number !== undefined
      ? (typeof body.serial_number === 'string' ? body.serial_number.trim() || null : null)
      : cur.serial_number;

  let condition = cur.condition;
  if (body.condition !== undefined) {
    if (typeof body.condition !== 'string' || !VALID_CONDITIONS.includes(body.condition as (typeof VALID_CONDITIONS)[number])) {
      return jsonError(400, 'invalid_condition');
    }
    condition = body.condition;
  }

  let rows: Array<Record<string, unknown>>;
  if (description !== null && serialNumber !== null) {
    rows = (await sql`
      UPDATE public.workforce_assets
      SET name          = ${name}::text,
          description   = ${description}::text,
          serial_number = ${serialNumber}::text,
          condition     = ${condition}::text,
          updated_at    = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, name, description, serial_number, condition, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (description !== null) {
    rows = (await sql`
      UPDATE public.workforce_assets
      SET name          = ${name}::text,
          description   = ${description}::text,
          serial_number = NULL,
          condition     = ${condition}::text,
          updated_at    = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, name, description, serial_number, condition, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (serialNumber !== null) {
    rows = (await sql`
      UPDATE public.workforce_assets
      SET name          = ${name}::text,
          description   = NULL,
          serial_number = ${serialNumber}::text,
          condition     = ${condition}::text,
          updated_at    = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, name, description, serial_number, condition, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      UPDATE public.workforce_assets
      SET name          = ${name}::text,
          description   = NULL,
          serial_number = NULL,
          condition     = ${condition}::text,
          updated_at    = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, name, description, serial_number, condition, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  }

  if (rows.length === 0) return jsonError(404, 'asset_not_found');
  return jsonOk({ asset: rows[0] });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.delete']);
  if (!a.ok) return a.res;

  const sql = db();

  const existing = (await sql`
    SELECT id FROM public.workforce_assets
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing.length === 0) return jsonError(404, 'asset_not_found');

  await sql`
    UPDATE public.workforce_assets
    SET condition  = 'retired',
        updated_at = now()
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

// /api/workforce/assets
//   GET  → list assets (workforce.assets.view)
//   POST → create asset (workforce.assets.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/assets' };

const VALID_CONDITIONS = ['good', 'fair', 'poor', 'retired'] as const;
const VALID_CREATE_CONDITIONS = ['good', 'fair', 'poor'] as const;

interface CreateAssetBody {
  name?: unknown;
  description?: unknown;
  serial_number?: unknown;
  condition?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const condition = url.searchParams.get('condition') || null;

  const sql = db();

  const assets = (await sql`
    SELECT
      a.id, a.name, a.description, a.serial_number, a.condition, a.created_at, a.updated_at,
      aa.id AS current_assignment_id,
      aa.user_node_id AS current_assignee_user_node_id,
      aa.assigned_at AS assigned_at
    FROM public.workforce_assets a
    LEFT JOIN public.asset_assignments aa
      ON aa.asset_id = a.id AND aa.returned_at IS NULL AND aa.client_id = ${a.ctx.clientId}::uuid
    WHERE a.client_id = ${a.ctx.clientId}::uuid
      AND (${condition}::text IS NULL OR a.condition = ${condition}::text)
      AND (${condition}::text IS NOT NULL OR a.condition != 'retired')
    ORDER BY a.created_at DESC
  `) as unknown[];

  return jsonOk({ assets });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.create']);
  if (!a.ok) return a.res;

  let body: CreateAssetBody;
  try {
    body = (await req.json()) as CreateAssetBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return jsonError(400, 'name_required');

  const description =
    typeof body.description === 'string' ? body.description.trim() || null : null;
  const serialNumber =
    typeof body.serial_number === 'string' ? body.serial_number.trim() || null : null;

  const conditionRaw = typeof body.condition === 'string' ? body.condition : 'good';
  if (!VALID_CREATE_CONDITIONS.includes(conditionRaw as (typeof VALID_CREATE_CONDITIONS)[number])) {
    return jsonError(400, 'invalid_condition');
  }
  const condition = conditionRaw;

  const sql = db();

  let rows: Array<Record<string, unknown>>;
  if (description !== null && serialNumber !== null) {
    rows = (await sql`
      INSERT INTO public.workforce_assets (client_id, name, description, serial_number, condition)
      VALUES (${a.ctx.clientId}::uuid, ${name}::text, ${description}::text, ${serialNumber}::text, ${condition}::text)
      RETURNING id, name, description, serial_number, condition, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (description !== null) {
    rows = (await sql`
      INSERT INTO public.workforce_assets (client_id, name, description, condition)
      VALUES (${a.ctx.clientId}::uuid, ${name}::text, ${description}::text, ${condition}::text)
      RETURNING id, name, description, serial_number, condition, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else if (serialNumber !== null) {
    rows = (await sql`
      INSERT INTO public.workforce_assets (client_id, name, serial_number, condition)
      VALUES (${a.ctx.clientId}::uuid, ${name}::text, ${serialNumber}::text, ${condition}::text)
      RETURNING id, name, description, serial_number, condition, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      INSERT INTO public.workforce_assets (client_id, name, condition)
      VALUES (${a.ctx.clientId}::uuid, ${name}::text, ${condition}::text)
      RETURNING id, name, description, serial_number, condition, created_at, updated_at
    `) as Array<Record<string, unknown>>;
  }

  const asset = {
    ...rows[0]!,
    current_assignment_id: null,
    current_assignee_user_node_id: null,
    assigned_at: null,
  };

  return jsonOk({ asset }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

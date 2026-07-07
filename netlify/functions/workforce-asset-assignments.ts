// /api/workforce/asset-assignments
//   GET   → list assignments (workforce.assets.view)
//   POST  → assign asset to user_node (workforce.assets.create)
//   PATCH → return assignment (workforce.assets.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/asset-assignments' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_RETURN_CONDITIONS = ['good', 'fair', 'poor'] as const;

interface AssignBody {
  asset_id?: unknown;
  user_node_id?: unknown;
  notes?: unknown;
}

interface ReturnBody {
  assignment_id?: unknown;
  condition_at_return?: unknown;
  notes?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const userNodeId = url.searchParams.get('user_node_id') || null;
  const assetId = url.searchParams.get('asset_id') || null;
  const activeOnly = url.searchParams.get('active') === 'true';

  const sql = db();

  let assignments: unknown[];
  if (activeOnly && userNodeId !== null && assetId !== null) {
    assignments = (await sql`
      SELECT aa.id, aa.asset_id, wa.name AS asset_name, aa.user_node_id,
             aa.assigned_at, aa.returned_at, aa.condition_at_return, aa.notes
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
        AND aa.user_node_id = ${userNodeId}::uuid
        AND aa.asset_id = ${assetId}::uuid
        AND aa.returned_at IS NULL
      ORDER BY aa.assigned_at DESC
    `) as unknown[];
  } else if (activeOnly && userNodeId !== null) {
    assignments = (await sql`
      SELECT aa.id, aa.asset_id, wa.name AS asset_name, aa.user_node_id,
             aa.assigned_at, aa.returned_at, aa.condition_at_return, aa.notes
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
        AND aa.user_node_id = ${userNodeId}::uuid
        AND aa.returned_at IS NULL
      ORDER BY aa.assigned_at DESC
    `) as unknown[];
  } else if (activeOnly && assetId !== null) {
    assignments = (await sql`
      SELECT aa.id, aa.asset_id, wa.name AS asset_name, aa.user_node_id,
             aa.assigned_at, aa.returned_at, aa.condition_at_return, aa.notes
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
        AND aa.asset_id = ${assetId}::uuid
        AND aa.returned_at IS NULL
      ORDER BY aa.assigned_at DESC
    `) as unknown[];
  } else if (activeOnly) {
    assignments = (await sql`
      SELECT aa.id, aa.asset_id, wa.name AS asset_name, aa.user_node_id,
             aa.assigned_at, aa.returned_at, aa.condition_at_return, aa.notes
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
        AND aa.returned_at IS NULL
      ORDER BY aa.assigned_at DESC
    `) as unknown[];
  } else if (userNodeId !== null && assetId !== null) {
    assignments = (await sql`
      SELECT aa.id, aa.asset_id, wa.name AS asset_name, aa.user_node_id,
             aa.assigned_at, aa.returned_at, aa.condition_at_return, aa.notes
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
        AND aa.user_node_id = ${userNodeId}::uuid
        AND aa.asset_id = ${assetId}::uuid
      ORDER BY aa.assigned_at DESC
    `) as unknown[];
  } else if (userNodeId !== null) {
    assignments = (await sql`
      SELECT aa.id, aa.asset_id, wa.name AS asset_name, aa.user_node_id,
             aa.assigned_at, aa.returned_at, aa.condition_at_return, aa.notes
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
        AND aa.user_node_id = ${userNodeId}::uuid
      ORDER BY aa.assigned_at DESC
    `) as unknown[];
  } else if (assetId !== null) {
    assignments = (await sql`
      SELECT aa.id, aa.asset_id, wa.name AS asset_name, aa.user_node_id,
             aa.assigned_at, aa.returned_at, aa.condition_at_return, aa.notes
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
        AND aa.asset_id = ${assetId}::uuid
      ORDER BY aa.assigned_at DESC
    `) as unknown[];
  } else {
    assignments = (await sql`
      SELECT aa.id, aa.asset_id, wa.name AS asset_name, aa.user_node_id,
             aa.assigned_at, aa.returned_at, aa.condition_at_return, aa.notes
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
      ORDER BY aa.assigned_at DESC
    `) as unknown[];
  }

  return jsonOk({ assignments });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.create']);
  if (!a.ok) return a.res;

  let body: AssignBody;
  try {
    body = (await req.json()) as AssignBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const assetId = typeof body.asset_id === 'string' ? body.asset_id.trim() : '';
  const userNodeId = typeof body.user_node_id === 'string' ? body.user_node_id.trim() : '';
  if (!assetId || !UUID.test(assetId)) return jsonError(400, 'asset_id_required');
  if (!userNodeId || !UUID.test(userNodeId)) return jsonError(400, 'user_node_id_required');

  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

  const sql = db();

  // Verify asset belongs to client.
  const assetRows = (await sql`
    SELECT id FROM public.workforce_assets
    WHERE id = ${assetId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (assetRows.length === 0) return jsonError(404, 'asset_not_found');

  // Verify user_node exists in client.
  const nodeRows = (await sql`
    SELECT id FROM public.user_nodes
    WHERE id = ${userNodeId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (nodeRows.length === 0) return jsonError(404, 'user_node_not_found');

  // Check for active assignment.
  const activeRows = (await sql`
    SELECT id FROM public.asset_assignments
    WHERE asset_id = ${assetId}::uuid AND client_id = ${a.ctx.clientId}::uuid
      AND returned_at IS NULL
    LIMIT 1
  `) as Array<{ id: string }>;
  if (activeRows.length > 0) return jsonError(409, 'asset_already_assigned');

  let rows: Array<Record<string, unknown>>;
  if (notes !== null) {
    rows = (await sql`
      INSERT INTO public.asset_assignments (client_id, asset_id, user_node_id, notes)
      VALUES (${a.ctx.clientId}::uuid, ${assetId}::uuid, ${userNodeId}::uuid, ${notes}::text)
      RETURNING id, asset_id, user_node_id, assigned_at, returned_at, condition_at_return, notes
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      INSERT INTO public.asset_assignments (client_id, asset_id, user_node_id)
      VALUES (${a.ctx.clientId}::uuid, ${assetId}::uuid, ${userNodeId}::uuid)
      RETURNING id, asset_id, user_node_id, assigned_at, returned_at, condition_at_return, notes
    `) as Array<Record<string, unknown>>;
  }

  return jsonOk({ assignment: rows[0] }, { status: 201 });
}

async function handlePatch(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.assets.edit']);
  if (!a.ok) return a.res;

  let body: ReturnBody;
  try {
    body = (await req.json()) as ReturnBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const assignmentId = typeof body.assignment_id === 'string' ? body.assignment_id.trim() : '';
  if (!assignmentId || !UUID.test(assignmentId)) return jsonError(400, 'assignment_id_required');

  const sql = db();

  const existing = (await sql`
    SELECT id, returned_at FROM public.asset_assignments
    WHERE id = ${assignmentId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; returned_at: string | null }>;
  if (existing.length === 0) return jsonError(404, 'assignment_not_found');
  if (existing[0]!.returned_at !== null) return jsonError(409, 'already_returned');

  let conditionAtReturn: string | null = null;
  if (body.condition_at_return !== undefined && body.condition_at_return !== null) {
    if (typeof body.condition_at_return !== 'string' ||
        !VALID_RETURN_CONDITIONS.includes(body.condition_at_return as (typeof VALID_RETURN_CONDITIONS)[number])) {
      return jsonError(400, 'invalid_condition_at_return');
    }
    conditionAtReturn = body.condition_at_return;
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

  let rows: Array<Record<string, unknown>>;
  if (conditionAtReturn !== null && notes !== null) {
    rows = (await sql`
      UPDATE public.asset_assignments
      SET returned_at         = now(),
          condition_at_return = ${conditionAtReturn}::text,
          notes               = ${notes}::text
      WHERE id = ${assignmentId}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, asset_id, user_node_id, assigned_at, returned_at, condition_at_return, notes
    `) as Array<Record<string, unknown>>;
  } else if (conditionAtReturn !== null) {
    rows = (await sql`
      UPDATE public.asset_assignments
      SET returned_at         = now(),
          condition_at_return = ${conditionAtReturn}::text,
          notes               = NULL
      WHERE id = ${assignmentId}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, asset_id, user_node_id, assigned_at, returned_at, condition_at_return, notes
    `) as Array<Record<string, unknown>>;
  } else if (notes !== null) {
    rows = (await sql`
      UPDATE public.asset_assignments
      SET returned_at         = now(),
          condition_at_return = NULL,
          notes               = ${notes}::text
      WHERE id = ${assignmentId}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, asset_id, user_node_id, assigned_at, returned_at, condition_at_return, notes
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      UPDATE public.asset_assignments
      SET returned_at         = now(),
          condition_at_return = NULL,
          notes               = NULL
      WHERE id = ${assignmentId}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, asset_id, user_node_id, assigned_at, returned_at, condition_at_return, notes
    `) as Array<Record<string, unknown>>;
  }

  if (rows.length === 0) return jsonError(404, 'assignment_not_found');
  return jsonOk({ assignment: rows[0] });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  if (req.method === 'PATCH') return handlePatch(req);
  return jsonError(405, 'method_not_allowed');
}

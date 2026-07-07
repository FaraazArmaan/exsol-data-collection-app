// /api/workforce/overtime
//   GET  → list OT entries; filters: resource_id, status, from, to (workforce.employees.view)
//   POST → log overtime (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/overtime' };

interface LogOtBody {
  resource_id?: unknown;
  user_node_id?: unknown;
  punch_id?: unknown;
  ot_date?: unknown;
  ot_hours?: unknown;
  reason?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const resourceId = url.searchParams.get('resource_id');
  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const sql = db();

  const entries = (await sql`
    SELECT
      o.id,
      o.resource_id,
      r.name AS resource_name,
      o.user_node_id,
      o.punch_id,
      to_char(o.ot_date, 'YYYY-MM-DD') AS ot_date,
      o.ot_hours,
      o.reason,
      o.status,
      o.handled_by,
      o.handled_at,
      o.created_at
    FROM public.overtime_entries o
    JOIN public.booking_resources r ON r.id = o.resource_id
    WHERE o.client_id = ${a.ctx.clientId}::uuid
      AND (${resourceId}::uuid IS NULL OR o.resource_id = ${resourceId}::uuid)
      AND (${status}::text IS NULL OR o.status = ${status}::text)
      AND (${from}::date IS NULL OR o.ot_date >= ${from}::date)
      AND (${to}::date IS NULL OR o.ot_date <= ${to}::date)
    ORDER BY o.ot_date DESC, o.created_at DESC
  `) as unknown[];

  return jsonOk({ entries });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  let body: LogOtBody;
  try {
    body = (await req.json()) as LogOtBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
  if (!resourceId) return jsonError(400, 'resource_id_required');

  const otDate = typeof body.ot_date === 'string' ? body.ot_date.trim() : '';
  if (!otDate) return jsonError(400, 'ot_date_required');

  const otHoursRaw = typeof body.ot_hours === 'number' ? body.ot_hours : Number(body.ot_hours);
  if (!body.ot_hours && body.ot_hours !== 0) return jsonError(400, 'ot_hours_required');
  if (isNaN(otHoursRaw) || otHoursRaw <= 0) return jsonError(400, 'ot_hours_must_be_positive');

  const userNodeId =
    typeof body.user_node_id === 'string' && body.user_node_id.trim()
      ? body.user_node_id.trim()
      : null;
  const punchId =
    typeof body.punch_id === 'string' && body.punch_id.trim()
      ? body.punch_id.trim()
      : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;

  const sql = db();

  // Validate resource belongs to this client.
  const resource = (await sql`
    SELECT id FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (resource.length === 0) return jsonError(404, 'resource_not_found');

  // Four INSERT branches to avoid NULL::uuid cast ambiguity (user_node_id × punch_id).
  let rows: Array<Record<string, unknown>>;
  if (userNodeId && punchId) {
    rows = (await sql`
      INSERT INTO public.overtime_entries
        (client_id, resource_id, user_node_id, punch_id, ot_date, ot_hours, reason)
      VALUES
        (${a.ctx.clientId}::uuid, ${resourceId}::uuid,
         ${userNodeId}::uuid, ${punchId}::uuid,
         ${otDate}::date, ${otHoursRaw}::numeric, ${reason}::text)
      RETURNING
        id, resource_id, user_node_id, punch_id,
        to_char(ot_date, 'YYYY-MM-DD') AS ot_date,
        ot_hours, reason, status, handled_by, handled_at, created_at
    `) as Array<Record<string, unknown>>;
  } else if (userNodeId) {
    rows = (await sql`
      INSERT INTO public.overtime_entries
        (client_id, resource_id, user_node_id, ot_date, ot_hours, reason)
      VALUES
        (${a.ctx.clientId}::uuid, ${resourceId}::uuid,
         ${userNodeId}::uuid,
         ${otDate}::date, ${otHoursRaw}::numeric, ${reason}::text)
      RETURNING
        id, resource_id, user_node_id, punch_id,
        to_char(ot_date, 'YYYY-MM-DD') AS ot_date,
        ot_hours, reason, status, handled_by, handled_at, created_at
    `) as Array<Record<string, unknown>>;
  } else if (punchId) {
    rows = (await sql`
      INSERT INTO public.overtime_entries
        (client_id, resource_id, punch_id, ot_date, ot_hours, reason)
      VALUES
        (${a.ctx.clientId}::uuid, ${resourceId}::uuid,
         ${punchId}::uuid,
         ${otDate}::date, ${otHoursRaw}::numeric, ${reason}::text)
      RETURNING
        id, resource_id, user_node_id, punch_id,
        to_char(ot_date, 'YYYY-MM-DD') AS ot_date,
        ot_hours, reason, status, handled_by, handled_at, created_at
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      INSERT INTO public.overtime_entries
        (client_id, resource_id, ot_date, ot_hours, reason)
      VALUES
        (${a.ctx.clientId}::uuid, ${resourceId}::uuid,
         ${otDate}::date, ${otHoursRaw}::numeric, ${reason}::text)
      RETURNING
        id, resource_id, user_node_id, punch_id,
        to_char(ot_date, 'YYYY-MM-DD') AS ot_date,
        ot_hours, reason, status, handled_by, handled_at, created_at
    `) as Array<Record<string, unknown>>;
  }

  return jsonOk({ entry: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

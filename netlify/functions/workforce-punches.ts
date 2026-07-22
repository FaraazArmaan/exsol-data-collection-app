// /api/workforce/punches
//   GET  → list punches; filters: resource_id, from, to (workforce.employees.view)
//   POST → clock in (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { workforceClientTimeZone } from './_workforce-depth-utils';

export const config = { path: '/api/workforce/punches' };

interface ClockInBody {
  resource_id?: unknown;
  user_node_id?: unknown;
  notes?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const resourceId = url.searchParams.get('resource_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const sql = db();
  const timeZone = await workforceClientTimeZone(a.ctx.clientId);

  const punches = (await sql`
    SELECT
      p.id,
      p.resource_id,
      p.user_node_id,
      p.shift_id,
      p.punched_in_at,
      p.punched_out_at,
      p.late_minutes,
      p.is_absent,
      p.notes,
      p.created_at
    FROM public.workforce_punches p
    WHERE p.client_id = ${a.ctx.clientId}::uuid
      AND (${resourceId}::uuid IS NULL OR p.resource_id = ${resourceId}::uuid)
      AND (${from}::date IS NULL OR (p.punched_in_at AT TIME ZONE ${timeZone}::text)::date >= ${from}::date)
      AND (${to}::date IS NULL OR (p.punched_in_at AT TIME ZONE ${timeZone}::text)::date <= ${to}::date)
    ORDER BY p.punched_in_at DESC
  `) as unknown[];

  return jsonOk({ punches });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  let body: ClockInBody;
  try {
    body = (await req.json()) as ClockInBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
  if (!resourceId) return jsonError(400, 'resource_id_required');

  const userNodeId =
    typeof body.user_node_id === 'string' && body.user_node_id.trim()
      ? body.user_node_id.trim()
      : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

  const sql = db();
  const timeZone = await workforceClientTimeZone(a.ctx.clientId);

  // Validate resource belongs to this client.
  const resource = (await sql`
    SELECT id FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (resource.length === 0) return jsonError(404, 'resource_not_found');

  // Check for already-open punch today.
  const openPunch = (await sql`
    SELECT id FROM public.workforce_punches
    WHERE resource_id = ${resourceId}::uuid
      AND client_id = ${a.ctx.clientId}::uuid
      AND punched_out_at IS NULL
      AND (punched_in_at AT TIME ZONE ${timeZone}::text)::date = (NOW() AT TIME ZONE ${timeZone}::text)::date
    LIMIT 1
  `) as Array<{ id: string }>;
  if (openPunch.length > 0) return jsonError(409, 'already_clocked_in');

  // Compute late_minutes via Postgres (avoids timezone issues).
  const shiftRows = (await sql`
    SELECT
      id,
      GREATEST(0, EXTRACT(EPOCH FROM (
        (NOW() AT TIME ZONE ${timeZone}::text)
        - ((NOW() AT TIME ZONE ${timeZone}::text)::date + start_time)
      ))::int / 60)::smallint AS late_minutes
    FROM public.workforce_shifts
    WHERE resource_id = ${resourceId}::uuid
      AND client_id = ${a.ctx.clientId}::uuid
      AND weekday = EXTRACT(DOW FROM (NOW() AT TIME ZONE ${timeZone}::text))::int
    ORDER BY start_time ASC
    LIMIT 1
  `) as Array<{ id: string; late_minutes: number }>;

  const shiftId = shiftRows.length > 0 ? shiftRows[0]!.id : null;
  const lateMinutes = shiftRows.length > 0 ? shiftRows[0]!.late_minutes : null;

  // Two INSERT branches to avoid NULL::uuid cast ambiguity for user_node_id.
  let rows: Array<Record<string, unknown>>;
  if (userNodeId) {
    rows = (await sql`
      INSERT INTO public.workforce_punches
        (client_id, resource_id, user_node_id, shift_id, late_minutes, notes)
      VALUES
        (${a.ctx.clientId}::uuid, ${resourceId}::uuid,
         ${userNodeId}::uuid, ${shiftId}::uuid, ${lateMinutes}::smallint, ${notes}::text)
      RETURNING
        id, resource_id, user_node_id, shift_id,
        punched_in_at, punched_out_at, late_minutes, is_absent, notes, created_at
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      INSERT INTO public.workforce_punches
        (client_id, resource_id, shift_id, late_minutes, notes)
      VALUES
        (${a.ctx.clientId}::uuid, ${resourceId}::uuid,
         ${shiftId}::uuid, ${lateMinutes}::smallint, ${notes}::text)
      RETURNING
        id, resource_id, user_node_id, shift_id,
        punched_in_at, punched_out_at, late_minutes, is_absent, notes, created_at
    `) as Array<Record<string, unknown>>;
  }

  return jsonOk({ punch: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

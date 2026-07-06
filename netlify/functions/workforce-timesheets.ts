// /api/workforce/timesheets
//   GET  → list entries; filters: resource_id, from (YYYY-MM-DD), to (YYYY-MM-DD)
//          (workforce.employees.view)
//   POST → log a new timesheet entry (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/timesheets' };

interface CreateBody {
  resource_id?: unknown;
  user_node_id?: unknown;
  entry_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
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
  const rows = (await sql`
    SELECT
      te.id,
      te.client_id,
      te.resource_id,
      br.name AS resource_name,
      te.user_node_id,
      un.display_name AS user_display_name,
      to_char(te.entry_date, 'YYYY-MM-DD') AS entry_date,
      left(te.start_time::text, 5) AS start_time,
      left(te.end_time::text, 5) AS end_time,
      te.notes,
      te.approved_by,
      te.approved_at,
      te.created_at
    FROM public.timesheet_entries te
    JOIN public.booking_resources br ON br.id = te.resource_id
    LEFT JOIN public.user_nodes un ON un.id = te.user_node_id
    WHERE te.client_id = ${a.ctx.clientId}::uuid
      AND (${resourceId}::uuid IS NULL OR te.resource_id = ${resourceId}::uuid)
      AND (${from}::date IS NULL OR te.entry_date >= ${from}::date)
      AND (${to}::date IS NULL OR te.entry_date <= ${to}::date)
    ORDER BY te.entry_date DESC, te.created_at DESC
  `) as unknown[];
  return jsonOk({ entries: rows });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
  if (!resourceId) return jsonError(400, 'resource_id_required');

  const entryDate = typeof body.entry_date === 'string' ? body.entry_date.trim() : '';
  if (!entryDate) return jsonError(400, 'entry_date_required');

  const startTime = typeof body.start_time === 'string' ? body.start_time.trim() : '';
  if (!startTime) return jsonError(400, 'start_time_required');

  const endTime = typeof body.end_time === 'string' ? body.end_time.trim() : '';
  if (!endTime) return jsonError(400, 'end_time_required');

  const userNodeId =
    typeof body.user_node_id === 'string' && body.user_node_id.trim()
      ? body.user_node_id.trim()
      : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

  const sql = db();

  // Validate resource belongs to this client.
  const resource = (await sql`
    SELECT id FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (resource.length === 0) return jsonError(404, 'resource_not_found');

  // Validate user_node belongs to this client (if provided).
  if (userNodeId) {
    const userNode = (await sql`
      SELECT id FROM public.user_nodes
      WHERE id = ${userNodeId}::uuid
        AND client_id = ${a.ctx.clientId}::uuid
      LIMIT 1
    `) as Array<{ id: string }>;
    if (!userNode.length) return jsonError(404, 'user_node_not_found');
  }

  try {
    const rows = (await sql`
      WITH ins AS (
        INSERT INTO public.timesheet_entries
          (client_id, resource_id, user_node_id, entry_date, start_time, end_time, notes)
        VALUES
          (${a.ctx.clientId}::uuid, ${resourceId}::uuid,
           ${userNodeId}::uuid, ${entryDate}::date,
           ${startTime}::time, ${endTime}::time, ${notes})
        RETURNING *
      )
      SELECT
        te.id,
        te.client_id,
        te.resource_id,
        br.name AS resource_name,
        te.user_node_id,
        un.display_name AS user_display_name,
        to_char(te.entry_date, 'YYYY-MM-DD') AS entry_date,
        left(te.start_time::text, 5) AS start_time,
        left(te.end_time::text, 5) AS end_time,
        te.notes,
        te.approved_by,
        te.approved_at,
        te.created_at
      FROM ins te
      JOIN public.booking_resources br ON br.id = te.resource_id
      LEFT JOIN public.user_nodes un ON un.id = te.user_node_id
    `) as Array<Record<string, unknown>>;
    return jsonOk({ entry: rows[0] }, { status: 201 });
  } catch (e) {
    const code = (e as { code?: string }).code;
    const constraint = (e as { constraint?: string }).constraint;
    if (code === '23514' || constraint === 'timesheet_entries_time_order') {
      return jsonError(400, 'end_time_must_be_after_start_time');
    }
    throw e;
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

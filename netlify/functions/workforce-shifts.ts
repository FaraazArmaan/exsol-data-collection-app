// /api/workforce/shifts
//   GET  ?resource_id=<uuid> → list shifts for a resource (workforce.employees.view)
//   POST { resource_id, user_node_id?, weekday, start_time, end_time } → create shift
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/shifts' };

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const resourceId = url.searchParams.get('resource_id');

  const sql = db();
  const rows = resourceId
    ? (await sql`
        SELECT ws.id, ws.resource_id, ws.user_node_id, ws.weekday,
               ws.start_time::text AS start_time, ws.end_time::text AS end_time,
               un.display_name AS user_display_name
        FROM public.workforce_shifts ws
        LEFT JOIN public.user_nodes un ON un.id = ws.user_node_id
        WHERE ws.client_id = ${a.ctx.clientId}::uuid
          AND ws.resource_id = ${resourceId}::uuid
        ORDER BY ws.weekday, ws.start_time
      `) as unknown[]
    : (await sql`
        SELECT ws.id, ws.resource_id, ws.user_node_id, ws.weekday,
               ws.start_time::text AS start_time, ws.end_time::text AS end_time,
               un.display_name AS user_display_name,
               br.name AS resource_name
        FROM public.workforce_shifts ws
        LEFT JOIN public.user_nodes un ON un.id = ws.user_node_id
        LEFT JOIN public.booking_resources br ON br.id = ws.resource_id
        WHERE ws.client_id = ${a.ctx.clientId}::uuid
        ORDER BY ws.weekday, ws.start_time
      `) as unknown[];
  return jsonOk({ shifts: rows });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
  const userNodeId = typeof body.user_node_id === 'string' ? body.user_node_id.trim() : null;
  const weekday = typeof body.weekday === 'number' ? body.weekday : -1;
  const startTime = typeof body.start_time === 'string' ? body.start_time.trim() : '';
  const endTime = typeof body.end_time === 'string' ? body.end_time.trim() : '';

  if (!resourceId) return jsonError(400, 'resource_id_required');
  if (!(WEEKDAYS as readonly number[]).includes(weekday)) return jsonError(400, 'weekday_invalid');
  if (!startTime) return jsonError(400, 'start_time_required');
  if (!endTime) return jsonError(400, 'end_time_required');

  const sql = db();

  // Verify resource belongs to this client.
  const res = (await sql`
    SELECT id FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (!res.length) return jsonError(404, 'resource_not_found');

  try {
    const rows = userNodeId
      ? (await sql`
          INSERT INTO public.workforce_shifts
            (client_id, resource_id, user_node_id, weekday, start_time, end_time)
          VALUES (
            ${a.ctx.clientId}::uuid, ${resourceId}::uuid, ${userNodeId}::uuid,
            ${weekday}, ${startTime}::time, ${endTime}::time
          )
          RETURNING id, resource_id, user_node_id, weekday,
                    start_time::text AS start_time, end_time::text AS end_time
        `) as Array<Record<string, unknown>>
      : (await sql`
          INSERT INTO public.workforce_shifts
            (client_id, resource_id, weekday, start_time, end_time)
          VALUES (
            ${a.ctx.clientId}::uuid, ${resourceId}::uuid,
            ${weekday}, ${startTime}::time, ${endTime}::time
          )
          RETURNING id, resource_id, user_node_id, weekday,
                    start_time::text AS start_time, end_time::text AS end_time
        `) as Array<Record<string, unknown>>;
    return jsonOk({ shift: rows[0] }, { status: 201 });
  } catch (e) {
    if ((e as { constraint?: string }).constraint === 'workforce_shifts_time_order') {
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

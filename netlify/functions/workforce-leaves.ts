// /api/workforce/leaves
//   GET  → list leave requests; filters: resource_id, status, from, to
//          (workforce.leave.view)
//   POST → create a leave request (workforce.leave.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/leaves' };

const VALID_LEAVE_TYPES = ['annual', 'sick', 'personal', 'unpaid'] as const;

interface CreateBody {
  resource_id?: unknown;
  user_node_id?: unknown;
  leave_type?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  notes?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.leave.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const resourceId = url.searchParams.get('resource_id');
  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const sql = db();

  const requests = (await sql`
    SELECT
      lr.id,
      lr.resource_id,
      br.name AS resource_name,
      lr.user_node_id,
      lr.leave_type,
      to_char(lr.start_date, 'YYYY-MM-DD') AS start_date,
      to_char(lr.end_date,   'YYYY-MM-DD') AS end_date,
      lr.notes,
      lr.status,
      lr.handled_by,
      lr.handled_at,
      lr.created_at
    FROM public.leave_requests lr
    JOIN public.booking_resources br ON br.id = lr.resource_id
    WHERE lr.client_id = ${a.ctx.clientId}::uuid
      AND (${resourceId}::uuid IS NULL OR lr.resource_id = ${resourceId}::uuid)
      AND (${status}::text IS NULL OR lr.status = ${status}::text)
      AND (${from}::date IS NULL OR lr.start_date >= ${from}::date)
      AND (${to}::date IS NULL OR lr.end_date <= ${to}::date)
    ORDER BY lr.created_at DESC
  `) as unknown[];

  // Fetch balances only when a specific resource is requested.
  let balances: unknown[] = [];
  if (resourceId) {
    balances = (await sql`
      SELECT id, resource_id, leave_type, balance_days, updated_at
      FROM public.leave_balances
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND resource_id = ${resourceId}::uuid
    `) as unknown[];
  }

  return jsonOk({ requests, balances });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.leave.create']);
  if (!a.ok) return a.res;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
  if (!resourceId) return jsonError(400, 'resource_id_required');

  const leaveType = typeof body.leave_type === 'string' ? body.leave_type.trim() : '';
  if (!leaveType) return jsonError(400, 'leave_type_required');
  if (!(VALID_LEAVE_TYPES as readonly string[]).includes(leaveType)) {
    return jsonError(400, 'invalid_leave_type');
  }

  const startDate = typeof body.start_date === 'string' ? body.start_date.trim() : '';
  if (!startDate) return jsonError(400, 'start_date_required');

  const endDate = typeof body.end_date === 'string' ? body.end_date.trim() : '';
  if (!endDate) return jsonError(400, 'end_date_required');

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

  const rows = (await sql`
    WITH ins AS (
      INSERT INTO public.leave_requests
        (client_id, resource_id, user_node_id, leave_type, start_date, end_date, notes)
      VALUES
        (${a.ctx.clientId}::uuid, ${resourceId}::uuid,
         ${userNodeId}::uuid, ${leaveType}, ${startDate}::date, ${endDate}::date, ${notes})
      RETURNING *
    )
    SELECT
      lr.id,
      lr.resource_id,
      br.name AS resource_name,
      lr.user_node_id,
      lr.leave_type,
      to_char(lr.start_date, 'YYYY-MM-DD') AS start_date,
      to_char(lr.end_date,   'YYYY-MM-DD') AS end_date,
      lr.notes,
      lr.status,
      lr.handled_by,
      lr.handled_at,
      lr.created_at
    FROM ins lr
    JOIN public.booking_resources br ON br.id = lr.resource_id
  `) as Array<Record<string, unknown>>;

  return jsonOk({ request: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

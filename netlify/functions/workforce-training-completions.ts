// /api/workforce/training-completions
//   GET  → list completions; filters: resource_id, course_id, expiring_soon (workforce.employees.view)
//   POST → log completion (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/training-completions' };

interface LogCompletionBody {
  course_id?: unknown;
  resource_id?: unknown;
  user_node_id?: unknown;
  completed_at?: unknown;
  cert_url?: unknown;
  notes?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const resourceId = url.searchParams.get('resource_id');
  const courseId = url.searchParams.get('course_id');
  const expiringSoon = url.searchParams.get('expiring_soon') === 'true';

  const sql = db();

  let completions: unknown[];
  if (expiringSoon) {
    completions = (await sql`
      SELECT
        tc_comp.id,
        tc_comp.course_id,
        tc.name AS course_name,
        tc_comp.resource_id,
        r.name  AS resource_name,
        tc_comp.user_node_id,
        to_char(tc_comp.completed_at, 'YYYY-MM-DD') AS completed_at,
        to_char(tc_comp.expires_at,   'YYYY-MM-DD') AS expires_at,
        tc_comp.cert_url,
        tc_comp.notes,
        CASE
          WHEN tc_comp.expires_at IS NULL THEN 'valid'
          WHEN tc_comp.expires_at < CURRENT_DATE THEN 'expired'
          WHEN tc_comp.expires_at <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END AS expiry_status,
        tc_comp.created_at
      FROM public.training_completions tc_comp
      JOIN public.training_courses   tc ON tc.id = tc_comp.course_id
      JOIN public.booking_resources   r ON r.id  = tc_comp.resource_id
      WHERE tc_comp.client_id = ${a.ctx.clientId}::uuid
        AND tc_comp.expires_at IS NOT NULL
        AND tc_comp.expires_at <= CURRENT_DATE + INTERVAL '30 days'
        AND (${resourceId}::uuid IS NULL OR tc_comp.resource_id = ${resourceId}::uuid)
        AND (${courseId}::uuid IS NULL OR tc_comp.course_id = ${courseId}::uuid)
      ORDER BY tc_comp.expires_at ASC
    `) as unknown[];
  } else {
    completions = (await sql`
      SELECT
        tc_comp.id,
        tc_comp.course_id,
        tc.name AS course_name,
        tc_comp.resource_id,
        r.name  AS resource_name,
        tc_comp.user_node_id,
        to_char(tc_comp.completed_at, 'YYYY-MM-DD') AS completed_at,
        to_char(tc_comp.expires_at,   'YYYY-MM-DD') AS expires_at,
        tc_comp.cert_url,
        tc_comp.notes,
        CASE
          WHEN tc_comp.expires_at IS NULL THEN 'valid'
          WHEN tc_comp.expires_at < CURRENT_DATE THEN 'expired'
          WHEN tc_comp.expires_at <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
          ELSE 'valid'
        END AS expiry_status,
        tc_comp.created_at
      FROM public.training_completions tc_comp
      JOIN public.training_courses   tc ON tc.id = tc_comp.course_id
      JOIN public.booking_resources   r ON r.id  = tc_comp.resource_id
      WHERE tc_comp.client_id = ${a.ctx.clientId}::uuid
        AND (${resourceId}::uuid IS NULL OR tc_comp.resource_id = ${resourceId}::uuid)
        AND (${courseId}::uuid IS NULL OR tc_comp.course_id = ${courseId}::uuid)
      ORDER BY tc_comp.completed_at DESC, tc_comp.created_at DESC
    `) as unknown[];
  }

  return jsonOk({ completions });
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  let body: LogCompletionBody;
  try {
    body = (await req.json()) as LogCompletionBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const courseId = typeof body.course_id === 'string' ? body.course_id.trim() : '';
  if (!courseId) return jsonError(400, 'course_id_required');

  const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
  if (!resourceId) return jsonError(400, 'resource_id_required');

  const completedAt = typeof body.completed_at === 'string' ? body.completed_at.trim() : '';
  if (!completedAt) return jsonError(400, 'completed_at_required');

  const userNodeId =
    typeof body.user_node_id === 'string' && body.user_node_id.trim()
      ? body.user_node_id.trim()
      : null;
  const certUrl =
    typeof body.cert_url === 'string' ? body.cert_url.trim() || null : null;
  const notes =
    typeof body.notes === 'string' ? body.notes.trim() || null : null;

  const sql = db();

  // Verify course belongs to client and get expiry_days.
  const courseRows = (await sql`
    SELECT id, expiry_days FROM public.training_courses
    WHERE id = ${courseId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; expiry_days: number | null }>;
  if (courseRows.length === 0) return jsonError(404, 'course_not_found');

  // Verify resource belongs to client.
  const resourceRows = (await sql`
    SELECT id FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (resourceRows.length === 0) return jsonError(404, 'resource_not_found');

  const expiryDays = courseRows[0]!.expiry_days
    ? Number(courseRows[0]!.expiry_days)
    : null;
  const expiresAt = expiryDays !== null ? addDays(completedAt, expiryDays) : null;

  // Two-branch for nullable user_node_id; expires_at is also nullable (pass as string or NULL).
  let rows: Array<Record<string, unknown>>;
  if (userNodeId !== null && expiresAt !== null) {
    rows = (await sql`
      INSERT INTO public.training_completions
        (client_id, course_id, resource_id, user_node_id, completed_at, expires_at, cert_url, notes)
      VALUES
        (${a.ctx.clientId}::uuid, ${courseId}::uuid, ${resourceId}::uuid,
         ${userNodeId}::uuid, ${completedAt}::date, ${expiresAt}::date,
         ${certUrl}::text, ${notes}::text)
      RETURNING
        id, course_id, resource_id, user_node_id,
        to_char(completed_at, 'YYYY-MM-DD') AS completed_at,
        to_char(expires_at,   'YYYY-MM-DD') AS expires_at,
        cert_url, notes, created_at
    `) as Array<Record<string, unknown>>;
  } else if (userNodeId !== null) {
    rows = (await sql`
      INSERT INTO public.training_completions
        (client_id, course_id, resource_id, user_node_id, completed_at, cert_url, notes)
      VALUES
        (${a.ctx.clientId}::uuid, ${courseId}::uuid, ${resourceId}::uuid,
         ${userNodeId}::uuid, ${completedAt}::date,
         ${certUrl}::text, ${notes}::text)
      RETURNING
        id, course_id, resource_id, user_node_id,
        to_char(completed_at, 'YYYY-MM-DD') AS completed_at,
        to_char(expires_at,   'YYYY-MM-DD') AS expires_at,
        cert_url, notes, created_at
    `) as Array<Record<string, unknown>>;
  } else if (expiresAt !== null) {
    rows = (await sql`
      INSERT INTO public.training_completions
        (client_id, course_id, resource_id, completed_at, expires_at, cert_url, notes)
      VALUES
        (${a.ctx.clientId}::uuid, ${courseId}::uuid, ${resourceId}::uuid,
         ${completedAt}::date, ${expiresAt}::date,
         ${certUrl}::text, ${notes}::text)
      RETURNING
        id, course_id, resource_id, user_node_id,
        to_char(completed_at, 'YYYY-MM-DD') AS completed_at,
        to_char(expires_at,   'YYYY-MM-DD') AS expires_at,
        cert_url, notes, created_at
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      INSERT INTO public.training_completions
        (client_id, course_id, resource_id, completed_at, cert_url, notes)
      VALUES
        (${a.ctx.clientId}::uuid, ${courseId}::uuid, ${resourceId}::uuid,
         ${completedAt}::date, ${certUrl}::text, ${notes}::text)
      RETURNING
        id, course_id, resource_id, user_node_id,
        to_char(completed_at, 'YYYY-MM-DD') AS completed_at,
        to_char(expires_at,   'YYYY-MM-DD') AS expires_at,
        cert_url, notes, created_at
    `) as Array<Record<string, unknown>>;
  }

  const row = rows[0]!;

  // Compute expiry_status from returned expires_at.
  const expiresAtOut = row.expires_at as string | null;
  let expiry_status: 'valid' | 'expiring_soon' | 'expired' = 'valid';
  if (expiresAtOut) {
    const exp = new Date(expiresAtOut);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const thirtyDays = new Date(now);
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    if (exp < now) {
      expiry_status = 'expired';
    } else if (exp <= thirtyDays) {
      expiry_status = 'expiring_soon';
    }
  }

  // Fetch course_name and resource_name for the response.
  const courseNameRows = (await sql`
    SELECT name FROM public.training_courses WHERE id = ${courseId}::uuid LIMIT 1
  `) as Array<{ name: string }>;
  const resourceNameRows = (await sql`
    SELECT name FROM public.booking_resources WHERE id = ${resourceId}::uuid LIMIT 1
  `) as Array<{ name: string }>;

  const completion = {
    ...row,
    course_name: courseNameRows[0]?.name ?? null,
    resource_name: resourceNameRows[0]?.name ?? null,
    expiry_status,
  };

  return jsonOk({ completion }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

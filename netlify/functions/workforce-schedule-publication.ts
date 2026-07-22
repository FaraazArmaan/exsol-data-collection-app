// /api/workforce/schedule-publication — published, dated schedule snapshots.
import { randomUUID } from 'node:crypto';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { requireWorkforce, type WorkforceAuthCtx } from './_workforce-authz';

export const config = { path: '/api/workforce/schedule-publication' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function weekStart(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1 ? value : null;
}

async function publicationPayload(ctx: WorkforceAuthCtx, start: string) {
  const sql = db();
  const versions = await sql`
    SELECT id, to_char(week_start, 'YYYY-MM-DD') AS week_start, status, acknowledgement_required,
      created_by, published_by, published_at, superseded_at, created_at
    FROM public.workforce_schedule_versions
    WHERE client_id = ${ctx.clientId}::uuid
      AND week_start = ${start}::date
      AND status = 'published'
    ORDER BY published_at DESC
    LIMIT 1
  ` as Array<Record<string, unknown>>;
  const version = versions[0] ?? null;
  if (!version) return { version: null, shifts: [], notice_summary: { recipients: 0, acknowledged: 0 } };
  const shifts = await sql`
    SELECT ss.id, ss.resource_id, br.name AS resource_name, ss.user_node_id, un.display_name AS user_display_name,
      to_char(ss.shift_date, 'YYYY-MM-DD') AS shift_date, left(ss.start_time::text, 5) AS start_time, left(ss.end_time::text, 5) AS end_time
    FROM public.workforce_schedule_version_shifts ss
    JOIN public.booking_resources br ON br.id = ss.resource_id
    LEFT JOIN public.user_nodes un ON un.id = ss.user_node_id
    WHERE ss.client_id = ${ctx.clientId}::uuid
      AND ss.schedule_version_id = ${String(version.id)}::uuid
    ORDER BY ss.shift_date, ss.start_time, br.name
  ` as Array<Record<string, unknown>>;
  const notices = await sql`
    SELECT COUNT(*)::int AS recipients,
      COUNT(*) FILTER (WHERE acknowledged_at IS NOT NULL)::int AS acknowledged
    FROM public.workforce_schedule_notices
    WHERE client_id = ${ctx.clientId}::uuid
      AND schedule_version_id = ${String(version.id)}::uuid
  ` as Array<{ recipients: number; acknowledged: number }>;
  return { version, shifts, notice_summary: notices[0] ?? { recipients: 0, acknowledged: 0 } };
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;
  const start = weekStart(new URL(req.url).searchParams.get('week_start'));
  if (!start) return jsonError(400, 'week_start_monday_required');
  return jsonOk(await publicationPayload(a.ctx, start));
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const start = weekStart(body.week_start);
  if (!start) return jsonError(400, 'week_start_monday_required');
  const acknowledgementRequired = body.acknowledgement_required === true;
  const sql = db();
  const templates = await sql`
    SELECT COUNT(*)::int AS count
    FROM public.workforce_shifts
    WHERE client_id = ${a.ctx.clientId}::uuid
  ` as Array<{ count: number }>;
  if ((templates[0]?.count ?? 0) === 0) return jsonError(409, 'schedule_empty');

  const versionId = randomUUID();
  await sql.transaction([
    sql`
      UPDATE public.workforce_schedule_versions
      SET status = 'superseded', superseded_at = now()
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND week_start = ${start}::date
        AND status = 'published'
    `,
    sql`
      INSERT INTO public.workforce_schedule_versions (
        id, client_id, week_start, status, acknowledgement_required, created_by, published_by, published_at
      )
      VALUES (
        ${versionId}::uuid, ${a.ctx.clientId}::uuid, ${start}::date, 'published', ${acknowledgementRequired}::boolean,
        ${a.ctx.userNodeId}::uuid, ${a.ctx.userNodeId}::uuid, now()
      )
    `,
    sql`
      INSERT INTO public.workforce_schedule_version_shifts (
        client_id, schedule_version_id, source_shift_id, resource_id, user_node_id, shift_date, start_time, end_time, source_snapshot
      )
      SELECT
        ws.client_id,
        ${versionId}::uuid,
        ws.id,
        ws.resource_id,
        ws.user_node_id,
        ${start}::date + ((ws.weekday + 6) % 7),
        ws.start_time,
        ws.end_time,
        jsonb_build_object('source_shift_id', ws.id, 'weekday', ws.weekday)
      FROM public.workforce_shifts ws
      WHERE ws.client_id = ${a.ctx.clientId}::uuid
    `,
    sql`
      INSERT INTO public.workforce_schedule_notices (
        client_id, schedule_version_id, user_node_id, acknowledgement_required
      )
      SELECT DISTINCT
        ss.client_id,
        ss.schedule_version_id,
        ss.user_node_id,
        ${acknowledgementRequired}::boolean
      FROM public.workforce_schedule_version_shifts ss
      WHERE ss.schedule_version_id = ${versionId}::uuid
        AND ss.user_node_id IS NOT NULL
    `,
  ]);
  return jsonOk(await publicationPayload(a.ctx, start), { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}

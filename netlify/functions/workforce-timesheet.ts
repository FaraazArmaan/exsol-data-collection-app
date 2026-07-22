// /api/workforce/timesheet/:id
//   PATCH  → update start_time, end_time, notes; or approve (workforce.employees.edit)
//   DELETE → remove entry if not yet approved (workforce.employees.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/timesheet/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/workforce\/timesheet\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

interface PatchBody {
  start_time?: unknown;
  end_time?: unknown;
  notes?: unknown;
  approve?: unknown;
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const startTime =
    typeof body.start_time === 'string' && body.start_time.trim()
      ? body.start_time.trim()
      : null;
  const endTime =
    typeof body.end_time === 'string' && body.end_time.trim()
      ? body.end_time.trim()
      : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;
  const approve = body.approve === true;

  const sql = db();

  const existing = (await sql`
    SELECT id, approved_at, user_node_id
    FROM public.timesheet_entries
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; approved_at: string | null; user_node_id: string | null }>;
  if (existing.length === 0) return jsonError(404, 'entry_not_found');
  if (existing[0]!.approved_at !== null) return jsonError(409, 'already_approved');
  if (approve && !existing[0]!.user_node_id) return jsonError(409, 'payable_user_required');

  try {
    const rows = (await sql`
      WITH upd AS (
        UPDATE public.timesheet_entries
        SET
          start_time  = COALESCE(${startTime}::time, start_time),
          end_time    = COALESCE(${endTime}::time, end_time),
          notes       = COALESCE(${notes}, notes),
          approved_by = CASE WHEN ${approve} THEN ${a.ctx.userNodeId}::uuid ELSE approved_by END,
          approved_at = CASE WHEN ${approve} THEN now() ELSE approved_at END,
          updated_at  = now()
        WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
        RETURNING *
      ), payable AS (
        INSERT INTO public.workforce_payable_time_entries (
          client_id,
          resource_id,
          user_node_id,
          work_date,
          minutes,
          source_type,
          source_id,
          approved_by,
          approved_at,
          notes,
          source_snapshot
        )
        SELECT
          upd.client_id,
          upd.resource_id,
          upd.user_node_id,
          upd.entry_date,
          ROUND(EXTRACT(EPOCH FROM (upd.end_time - upd.start_time)) / 60)::integer,
          'approved_timesheet',
          upd.id,
          ${a.ctx.userNodeId}::uuid,
          upd.approved_at,
          upd.notes,
          jsonb_build_object(
            'entry_date', to_char(upd.entry_date, 'YYYY-MM-DD'),
            'start_time', left(upd.start_time::text, 5),
            'end_time', left(upd.end_time::text, 5),
            'timesheet_id', upd.id
          )
        FROM upd
        WHERE ${approve}
        ON CONFLICT (client_id, source_type, source_id) DO NOTHING
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
      FROM upd te
      JOIN public.booking_resources br ON br.id = te.resource_id
      LEFT JOIN public.user_nodes un ON un.id = te.user_node_id
    `) as Array<Record<string, unknown>>;
    if (rows.length === 0) return jsonError(404, 'entry_not_found');
    return jsonOk({ entry: rows[0] });
  } catch (e) {
    const code = (e as { code?: string }).code;
    const constraint = (e as { constraint?: string }).constraint;
    if (code === '23514' || constraint === 'timesheet_entries_time_order') {
      return jsonError(400, 'end_time_must_be_after_start_time');
    }
    throw e;
  }
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.delete']);
  if (!a.ok) return a.res;

  const sql = db();
  const entry = (await sql`
    SELECT id, approved_at
    FROM public.timesheet_entries
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; approved_at: string | null }>;

  if (entry.length === 0) return jsonError(404, 'entry_not_found');
  if (entry[0]!.approved_at !== null) return jsonError(409, 'already_approved');

  await sql`
    DELETE FROM public.timesheet_entries
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

// GET /api/hr/dashboard — headcount by role/level, joins/exits, and a best-effort
// Workforce time-logged summary. Reads canonical user_nodes + HR offboarding
// records; workforce timesheets are read cross-domain (no leave table exists yet).
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireHr } from './_hr-authz';

export const config = { path: '/api/hr/dashboard', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireHr(req, ['hr.employees.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const cid = a.ctx.clientId;

  const headcount = (await sql`
    SELECT un.level_number, cl.label AS level_label, cr.label AS role_label, cr.color AS role_color, count(*)::int AS count
    FROM public.user_nodes un
    LEFT JOIN public.client_levels cl ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    LEFT JOIN public.client_roles cr ON cr.id = un.role_id
    WHERE un.client_id = ${cid}::uuid
    GROUP BY un.level_number, cl.label, cr.label, cr.color
    ORDER BY un.level_number NULLS LAST, cr.label
  `) as unknown[];

  const totals = (await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS join30,
           count(*) FILTER (WHERE created_at > now() - interval '90 days')::int AS join90
    FROM public.user_nodes WHERE client_id = ${cid}::uuid
  `) as Array<{ total: number; join30: number; join90: number }>;

  const recentJoins = (await sql`
    SELECT un.id, un.display_name, cr.label AS role_label, un.created_at
    FROM public.user_nodes un LEFT JOIN public.client_roles cr ON cr.id = un.role_id
    WHERE un.client_id = ${cid}::uuid ORDER BY un.created_at DESC LIMIT 5
  `) as unknown[];

  const exitTotals = (await sql`
    SELECT count(*) FILTER (WHERE completed_at > now() - interval '30 days')::int AS exit30,
           count(*) FILTER (WHERE completed_at > now() - interval '90 days')::int AS exit90
    FROM public.hr_checklist_instances
    WHERE client_id = ${cid}::uuid AND kind = 'offboarding' AND status = 'completed'
  `) as Array<{ exit30: number; exit90: number }>;

  const recentExits = (await sql`
    SELECT id, subject_name, completed_at
    FROM public.hr_checklist_instances
    WHERE client_id = ${cid}::uuid AND kind = 'offboarding' AND status = 'completed' AND completed_at IS NOT NULL
    ORDER BY completed_at DESC LIMIT 5
  `) as unknown[];

  // Cross-domain read of Workforce timesheets — best-effort so a schema/absence
  // difference can't 500 the whole dashboard.
  let workforce = { entries: 0, hours: 0 };
  try {
    const wf = (await sql`
      SELECT count(*)::int AS entries,
             COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0), 0)::float AS hours
      FROM public.timesheet_entries
      WHERE client_id = ${cid}::uuid AND entry_date > (now() - interval '30 days')::date
    `) as Array<{ entries: number; hours: number }>;
    workforce = { entries: wf[0]?.entries ?? 0, hours: Math.round(((wf[0]?.hours ?? 0)) * 10) / 10 };
  } catch { /* workforce timesheets unavailable — leave zeros */ }

  const t = totals[0] ?? { total: 0, join30: 0, join90: 0 };
  const x = exitTotals[0] ?? { exit30: 0, exit90: 0 };
  return jsonOk({
    headcount,
    totalHeadcount: t.total,
    joins: { last30: t.join30, last90: t.join90, recent: recentJoins },
    exits: { last30: x.exit30, last90: x.exit90, recent: recentExits },
    workforce,
  });
}

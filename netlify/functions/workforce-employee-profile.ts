// /api/workforce/employee-profile
//   GET → aggregate profile for a booking_resource (workforce.employees.view)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/employee-profile' };

function weekBounds(today: Date): { weekStart: string; weekEnd: string; todayStr: string } {
  const dayOfWeek = today.getDay(); // 0 = Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() + mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { weekStart: fmt(weekStart), weekEnd: fmt(weekEnd), todayStr: fmt(today) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const resourceId = url.searchParams.get('resource_id') ?? '';
  if (!resourceId) return jsonError(400, 'resource_id_required');
  if (!UUID_RE.test(resourceId)) return jsonError(400, 'resource_id_invalid');

  const clientId = a.ctx.clientId;
  const sql = db();
  const { weekStart, weekEnd, todayStr } = weekBounds(new Date());

  // Run all independent queries in parallel — cast through unknown to satisfy TS.
  const [
    resourceRows,
    shiftCountRows,
    punchCountRows,
    hoursRows,
    otRows,
    onLeaveRows,
    leaveSummaryRows,
    balanceRows,
    trainingRows,
    userNodeRows,
  ] = await Promise.all([
    // 1. Resource info
    sql`
      SELECT br.id, br.name, p.user_node_id
      FROM public.booking_resources br
      LEFT JOIN public.workforce_employee_profiles p
        ON p.client_id = br.bucket_id AND p.resource_id = br.id
      WHERE br.id = ${resourceId}::uuid AND br.bucket_id = ${clientId}::uuid
      LIMIT 1
    ` as unknown as Promise<Array<{ id: string; name: string; user_node_id: string | null }>>,

    // 2. Total scheduled shifts for this resource
    sql`
      SELECT COUNT(*)::text AS shift_count
      FROM public.workforce_shifts
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
    ` as unknown as Promise<Array<{ shift_count: string }>>,

    // 3. Punches this week
    sql`
      SELECT COUNT(*)::text AS punch_count
      FROM public.workforce_punches
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
        AND punched_in_at >= ${weekStart}::date
        AND punched_in_at < (${weekEnd}::date + INTERVAL '1 day')
    ` as unknown as Promise<Array<{ punch_count: string }>>,

    // 4. Approved timesheet hours this week
    sql`
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600), 0)::numeric(10,2)::text AS total_hours
      FROM public.timesheet_entries
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
        AND entry_date >= ${weekStart}::date AND entry_date <= ${weekEnd}::date
        AND approved_at IS NOT NULL
    ` as unknown as Promise<Array<{ total_hours: string }>>,

    // 5. Approved OT hours this week
    sql`
      SELECT COALESCE(SUM(ot_hours), 0)::numeric(10,2)::text AS ot_hours
      FROM public.overtime_entries
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
        AND ot_date >= ${weekStart}::date AND ot_date <= ${weekEnd}::date
        AND status = 'approved'
    ` as unknown as Promise<Array<{ ot_hours: string }>>,

    // 6. On leave today (approved)
    sql`
      SELECT (COUNT(*) > 0) AS on_leave
      FROM public.leave_requests
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
        AND status = 'approved'
        AND start_date <= ${todayStr}::date AND end_date >= ${todayStr}::date
    ` as unknown as Promise<Array<{ on_leave: boolean }>>,

    // 7. Leave summary — pending + approved this month
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
        COUNT(*) FILTER (
          WHERE status = 'approved'
            AND EXTRACT(MONTH FROM start_date) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        )::text AS approved_this_month
      FROM public.leave_requests
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
    ` as unknown as Promise<Array<{ pending: string; approved_this_month: string }>>,

    // 8. Leave balances
    sql`
      SELECT leave_type, balance_days::text AS balance_days
      FROM public.leave_balances
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
      ORDER BY leave_type
    ` as unknown as Promise<Array<{ leave_type: string; balance_days: string }>>,

    // 9. Training summary
    sql`
      SELECT
        COUNT(*)::text AS completed,
        COUNT(*) FILTER (
          WHERE expires_at IS NOT NULL
            AND expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
        )::text AS expiring_soon,
        COUNT(*) FILTER (
          WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE
        )::text AS expired
      FROM public.training_completions
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
    ` as unknown as Promise<Array<{ completed: string; expiring_soon: string; expired: string }>>,

    // 10. Look up the most recent user_node_id associated with this resource (for assets)
    sql`
      SELECT user_node_id FROM public.workforce_punches
      WHERE resource_id = ${resourceId}::uuid AND client_id = ${clientId}::uuid
        AND user_node_id IS NOT NULL
      ORDER BY punched_in_at DESC
      LIMIT 1
    ` as unknown as Promise<Array<{ user_node_id: string }>>,
  ]);

  // Resource must exist and belong to this client.
  if (resourceRows.length === 0) return jsonError(404, 'resource_not_found');

  const resource = resourceRows[0]!;

  // Assets: only fetch if we have a user_node_id.
  const userNodeId = resource.user_node_id ?? userNodeRows[0]?.user_node_id ?? null;
  let assetItems: Array<{ id: string; asset_name: string; condition: string; assigned_at: string }> = [];
  if (userNodeId) {
    const assetRows = (await sql`
      SELECT aa.id, wa.name AS asset_name, wa.condition,
             to_char(aa.assigned_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS assigned_at
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.user_node_id = ${userNodeId}::uuid
        AND aa.client_id = ${clientId}::uuid
        AND aa.returned_at IS NULL
      ORDER BY aa.assigned_at DESC
    `) as Array<{ id: string; asset_name: string; condition: string; assigned_at: string }>;
    assetItems = assetRows;
  }

  return jsonOk({
    resource: { id: resource.id, name: resource.name },
    this_week: {
      shifts: Number(shiftCountRows[0]?.shift_count ?? 0),
      punches: Number(punchCountRows[0]?.punch_count ?? 0),
      hours_worked: Number(hoursRows[0]?.total_hours ?? 0),
      ot_hours: Number(otRows[0]?.ot_hours ?? 0),
      on_leave: !!(onLeaveRows[0]?.on_leave),
    },
    leave: {
      pending: Number(leaveSummaryRows[0]?.pending ?? 0),
      approved_this_month: Number(leaveSummaryRows[0]?.approved_this_month ?? 0),
      balances: balanceRows.map(b => ({
        leave_type: b.leave_type,
        balance_days: Number(b.balance_days),
      })),
    },
    training: {
      completed: Number(trainingRows[0]?.completed ?? 0),
      expiring_soon: Number(trainingRows[0]?.expiring_soon ?? 0),
      expired: Number(trainingRows[0]?.expired ?? 0),
    },
    assets: {
      active_count: assetItems.length,
      items: assetItems,
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  return jsonError(405, 'method_not_allowed');
}

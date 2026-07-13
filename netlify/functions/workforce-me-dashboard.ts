// /api/workforce/me/dashboard — employee self-service Workforce summary.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforceSelf, resolveSelfEmployee } from './_workforce-self-time';

export const config = { path: '/api/workforce/me/dashboard' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;

  const sql = db();
  const [
    leaveRows,
    balanceRows,
    shiftRows,
    swapRows,
    payslipRows,
    trainingRows,
    assetRows,
    correctionRows,
    taskRows,
  ] = await Promise.all([
    sql`
      SELECT id, leave_type, to_char(start_date, 'YYYY-MM-DD') AS start_date,
             to_char(end_date, 'YYYY-MM-DD') AS end_date, notes, status, created_at
      FROM public.leave_requests
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND resource_id = ${employee.resource_id}::uuid
      ORDER BY created_at DESC
      LIMIT 6
    `,
    sql`
      SELECT leave_type, balance_days
      FROM public.leave_balances
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND resource_id = ${employee.resource_id}::uuid
      ORDER BY leave_type
    `,
    sql`
      SELECT id, weekday, start_time::text AS start_time, end_time::text AS end_time
      FROM public.workforce_shifts
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND resource_id = ${employee.resource_id}::uuid
      ORDER BY weekday, start_time
    `,
    sql`
      SELECT
        s.id,
        s.offering_shift_id,
        s.offering_resource_id,
        o.name AS offering_resource_name,
        to_char(s.offering_date, 'YYYY-MM-DD') AS offering_date,
        s.claimed_by_resource_id,
        c.name AS claimed_by_resource_name,
        s.claimed_at,
        s.status,
        s.notes,
        s.created_at,
        (s.offering_resource_id = ${employee.resource_id}::uuid) AS is_mine,
        (s.claimed_by_resource_id = ${employee.resource_id}::uuid) AS claimed_by_me
      FROM public.shift_swaps s
      JOIN public.booking_resources o ON o.id = s.offering_resource_id
      LEFT JOIN public.booking_resources c ON c.id = s.claimed_by_resource_id
      WHERE s.client_id = ${a.ctx.clientId}::uuid
        AND (
          s.offering_resource_id = ${employee.resource_id}::uuid
          OR s.claimed_by_resource_id = ${employee.resource_id}::uuid
          OR s.status = 'open'
        )
      ORDER BY s.offering_date ASC, s.created_at DESC
      LIMIT 12
    `,
    sql`
      SELECT ps.id, ps.gross_amount, ps.tax_amount, ps.deductions_amount, ps.net_amount,
             ps.currency, ps.status, ps.published_at, ps.created_at,
             to_char(pp.period_start, 'YYYY-MM-DD') AS period_start,
             to_char(pp.period_end, 'YYYY-MM-DD') AS period_end
      FROM public.workforce_payslips ps
      JOIN public.payroll_periods pp ON pp.id = ps.period_id
      WHERE ps.client_id = ${a.ctx.clientId}::uuid
        AND ps.user_node_id = ${a.ctx.userNodeId}::uuid
        AND ps.status <> 'void'
      ORDER BY ps.created_at DESC
      LIMIT 4
    `,
    sql`
      SELECT c.id AS course_id, c.name, c.description, c.is_required, c.expiry_days,
             tc.completed_at, tc.expires_at, tc.cert_url
      FROM public.training_courses c
      LEFT JOIN public.training_completions tc
        ON tc.course_id = c.id
       AND tc.client_id = c.client_id
       AND tc.resource_id = ${employee.resource_id}::uuid
      WHERE c.client_id = ${a.ctx.clientId}::uuid
        AND (c.is_required = true OR tc.id IS NOT NULL)
      ORDER BY c.is_required DESC, c.name ASC
      LIMIT 12
    `,
    sql`
      SELECT aa.id AS assignment_id, aa.assigned_at, aa.returned_at, aa.notes,
             wa.id AS asset_id, wa.name, wa.serial_number, wa.condition
      FROM public.asset_assignments aa
      JOIN public.workforce_assets wa ON wa.id = aa.asset_id
      WHERE aa.client_id = ${a.ctx.clientId}::uuid
        AND aa.user_node_id = ${a.ctx.userNodeId}::uuid
        AND aa.returned_at IS NULL
      ORDER BY aa.assigned_at DESC
      LIMIT 8
    `,
    sql`
      SELECT id, correction_type, status, notes, created_at, reviewed_at
      FROM public.workforce_time_corrections
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND resource_id = ${employee.resource_id}::uuid
        AND requested_by = ${a.ctx.userNodeId}::uuid
      ORDER BY created_at DESC
      LIMIT 6
    `,
    sql`
      SELECT t.id, t.status, t.due_date, t.completed_at, t.notes, r.name AS requirement_name,
             r.requirement_type
      FROM public.workforce_compliance_tasks t
      LEFT JOIN public.workforce_compliance_requirements r ON r.id = t.requirement_id
      WHERE t.client_id = ${a.ctx.clientId}::uuid
        AND t.resource_id = ${employee.resource_id}::uuid
        AND t.status IN ('pending','overdue')
      ORDER BY t.due_date NULLS LAST, t.created_at DESC
      LIMIT 8
    `,
  ]);

  return jsonOk({
    employee,
    leave_requests: leaveRows,
    leave_balances: balanceRows,
    shifts: shiftRows,
    swaps: swapRows,
    payslips: payslipRows,
    training: trainingRows,
    assets: assetRows,
    corrections: correctionRows,
    compliance_tasks: taskRows,
  });
}

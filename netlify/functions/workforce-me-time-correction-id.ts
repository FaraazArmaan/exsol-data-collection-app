// /api/workforce/me/time-correction/:id — employee cancels their own pending correction.
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { requireWorkforceSelf, resolveSelfEmployee } from './_workforce-self-time';

export const config = { path: '/api/workforce/me/time-correction/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'DELETE') return jsonError(405, 'method_not_allowed');
  const id = new URL(req.url).pathname.match(/workforce\/me\/time-correction\/([^/?]+)/)?.[1];
  if (!id || !UUID.test(id)) return jsonError(400, 'invalid_id');
  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;
  const rows = await db()`
    WITH cancelled AS (
      UPDATE public.workforce_time_corrections
      SET status = 'cancelled', resolution_note = 'Cancelled by employee', updated_at = now()
      WHERE id = ${id}::uuid
        AND client_id = ${a.ctx.clientId}::uuid
        AND resource_id = ${employee.resource_id}::uuid
        AND requested_by = ${a.ctx.userNodeId}::uuid
        AND status = 'pending'
      RETURNING id, client_id, resource_id, requested_by
    ), event AS (
      INSERT INTO public.workforce_time_clock_events (
        client_id, resource_id, user_node_id, event_type, source, notes, recorded_by
      )
      SELECT client_id, resource_id, requested_by, 'correction', 'self_service', 'Employee cancelled correction request.', requested_by
      FROM cancelled
    )
    SELECT id FROM cancelled
  ` as Array<{ id: string }>;
  if (rows.length === 0) return jsonError(409, 'cannot_cancel_correction');
  return new Response(null, { status: 204 });
}

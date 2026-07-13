// /api/workforce/me/leave-request/:id — employee cancels own pending leave.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforceSelf, resolveSelfEmployee } from './_workforce-self-time';

export const config = { path: '/api/workforce/me/leave-request/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/workforce\/me\/leave-request\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'DELETE') return jsonError(405, 'method_not_allowed');
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;

  const existing = await db()`
    SELECT id, status
    FROM public.leave_requests
    WHERE id = ${id}::uuid
      AND client_id = ${a.ctx.clientId}::uuid
      AND resource_id = ${employee.resource_id}::uuid
      AND user_node_id = ${a.ctx.userNodeId}::uuid
    LIMIT 1
  ` as Array<{ id: string; status: string }>;
  if (existing.length === 0) return jsonError(404, 'request_not_found');
  if (existing[0]!.status !== 'pending') return jsonError(409, 'cannot_cancel_handled');
  await db()`
    DELETE FROM public.leave_requests
    WHERE id = ${id}::uuid
      AND client_id = ${a.ctx.clientId}::uuid
  `;
  return new Response(null, { status: 204 });
}

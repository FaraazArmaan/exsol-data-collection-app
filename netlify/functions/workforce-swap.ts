// /api/workforce/swap/:id
//   PATCH  → action on a swap: claim | approve | deny | cancel (workforce.employees.edit)
//   DELETE → hard delete (workforce.employees.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { recordApprovalDecision, requireApprovalOwner } from './_workforce-approval-routing';

export const config = { path: '/api/workforce/swap/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/\/swap\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;

  let body: { action?: unknown; resource_id?: unknown };
  try {
    body = (await req.json()) as { action?: unknown; resource_id?: unknown };
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const action = typeof body.action === 'string' ? body.action : '';
  if (!['claim', 'approve', 'deny', 'cancel'].includes(action)) {
    return jsonError(400, 'invalid_action');
  }

  const sql = db();

  const existing = (await sql`
    SELECT s.id, s.status, p.user_node_id
    FROM public.shift_swaps s
    LEFT JOIN public.workforce_employee_profiles p
      ON p.client_id = s.client_id AND p.resource_id = s.offering_resource_id
    WHERE s.id = ${id}::uuid AND s.client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string; user_node_id: string | null }>;
  if (existing.length === 0) return jsonError(404, 'swap_not_found');

  const currentStatus = existing[0]!.status;
  let routing: Awaited<ReturnType<typeof requireApprovalOwner>> | null = null;
  if (action === 'approve' || action === 'deny') {
    routing = await requireApprovalOwner(a.ctx, 'shift_swap', existing[0]!.user_node_id);
    if (routing instanceof Response) return routing;
  }
  let rows: Array<Record<string, unknown>>;

  if (action === 'claim') {
    if (currentStatus !== 'open') return jsonError(409, 'not_open');
    const resourceId = typeof body.resource_id === 'string' ? body.resource_id.trim() : '';
    if (!resourceId) return jsonError(400, 'resource_id_required');
    rows = (await sql`
      UPDATE public.shift_swaps
      SET
        claimed_by_resource_id = ${resourceId}::uuid,
        claimed_at             = now(),
        status                 = 'claimed',
        updated_at             = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING
        id, offering_shift_id, offering_resource_id,
        to_char(offering_date, 'YYYY-MM-DD') AS offering_date,
        claimed_by_resource_id, claimed_at, status, notes,
        handled_by, handled_at, created_at
    `) as Array<Record<string, unknown>>;
  } else if (action === 'approve') {
    if (currentStatus !== 'claimed') return jsonError(409, 'not_claimed');
    rows = (await sql`
      UPDATE public.shift_swaps
      SET
        status     = 'approved',
        handled_by = ${a.ctx.userNodeId}::uuid,
        handled_at = now(),
        updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING
        id, offering_shift_id, offering_resource_id,
        to_char(offering_date, 'YYYY-MM-DD') AS offering_date,
        claimed_by_resource_id, claimed_at, status, notes,
        handled_by, handled_at, created_at
    `) as Array<Record<string, unknown>>;
  } else if (action === 'deny') {
    if (currentStatus !== 'claimed') return jsonError(409, 'not_claimed');
    rows = (await sql`
      UPDATE public.shift_swaps
      SET
        status     = 'denied',
        handled_by = ${a.ctx.userNodeId}::uuid,
        handled_at = now(),
        updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING
        id, offering_shift_id, offering_resource_id,
        to_char(offering_date, 'YYYY-MM-DD') AS offering_date,
        claimed_by_resource_id, claimed_at, status, notes,
        handled_by, handled_at, created_at
    `) as Array<Record<string, unknown>>;
  } else {
    // cancel
    if (currentStatus === 'approved' || currentStatus === 'denied' || currentStatus === 'cancelled') {
      return jsonError(409, 'cannot_cancel');
    }
    rows = (await sql`
      UPDATE public.shift_swaps
      SET
        status     = 'cancelled',
        updated_at = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING
        id, offering_shift_id, offering_resource_id,
        to_char(offering_date, 'YYYY-MM-DD') AS offering_date,
        claimed_by_resource_id, claimed_at, status, notes,
        handled_by, handled_at, created_at
    `) as Array<Record<string, unknown>>;
  }

  if (rows.length === 0) return jsonError(404, 'swap_not_found');
  if ((action === 'approve' || action === 'deny') && routing && !(routing instanceof Response)) {
    await recordApprovalDecision(a.ctx, 'shift_swap', id, routing.ownerUserNodeId, action === 'approve' ? 'approved' : 'denied');
  }
  return jsonOk({ swap: rows[0] });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.delete']);
  if (!a.ok) return a.res;

  const sql = db();

  const existing = (await sql`
    SELECT id, status FROM public.shift_swaps
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string }>;
  if (existing.length === 0) return jsonError(404, 'swap_not_found');
  if (existing[0]!.status === 'approved') return jsonError(409, 'cannot_delete_approved');

  await sql`
    DELETE FROM public.shift_swaps
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

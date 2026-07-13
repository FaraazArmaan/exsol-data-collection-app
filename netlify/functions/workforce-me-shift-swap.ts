// /api/workforce/me/shift-swap/:id — employee claims/cancels scoped swaps.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { readJsonObject, requireWorkforceSelf, resolveSelfEmployee } from './_workforce-self-time';

export const config = { path: '/api/workforce/me/shift-swap/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/workforce\/me\/shift-swap\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');

  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const employee = await resolveSelfEmployee(a.ctx);
  if (employee instanceof Response) return employee;
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (action !== 'claim' && action !== 'cancel') return jsonError(400, 'invalid_action');

  const existing = await db()`
    SELECT id, status, offering_resource_id, claimed_by_resource_id
    FROM public.shift_swaps
    WHERE id = ${id}::uuid
      AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  ` as Array<{ id: string; status: string; offering_resource_id: string; claimed_by_resource_id: string | null }>;
  if (existing.length === 0) return jsonError(404, 'swap_not_found');
  const swap = existing[0]!;

  let rows: Array<Record<string, unknown>>;
  if (action === 'claim') {
    if (swap.status !== 'open') return jsonError(409, 'not_open');
    if (swap.offering_resource_id === employee.resource_id) return jsonError(409, 'cannot_claim_own_swap');
    rows = await db()`
      UPDATE public.shift_swaps
      SET claimed_by_resource_id = ${employee.resource_id}::uuid,
          claimed_at = now(),
          status = 'claimed',
          updated_at = now()
      WHERE id = ${id}::uuid
        AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, offering_shift_id, offering_resource_id,
        to_char(offering_date, 'YYYY-MM-DD') AS offering_date,
        claimed_by_resource_id, claimed_at, status, notes, created_at
    ` as Array<Record<string, unknown>>;
  } else {
    const ownsSwap = swap.offering_resource_id === employee.resource_id || swap.claimed_by_resource_id === employee.resource_id;
    if (!ownsSwap) return jsonError(404, 'swap_not_found');
    if (swap.status === 'approved' || swap.status === 'denied' || swap.status === 'cancelled') {
      return jsonError(409, 'cannot_cancel');
    }
    rows = await db()`
      UPDATE public.shift_swaps
      SET status = 'cancelled',
          updated_at = now()
      WHERE id = ${id}::uuid
        AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, offering_shift_id, offering_resource_id,
        to_char(offering_date, 'YYYY-MM-DD') AS offering_date,
        claimed_by_resource_id, claimed_at, status, notes, created_at
    ` as Array<Record<string, unknown>>;
  }

  return jsonOk({ swap: rows[0] });
}

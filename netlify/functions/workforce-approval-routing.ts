// /api/workforce/approval-routing — owner-configured approval policy and time-bounded delegation.
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

const TYPES = new Set(['leave', 'overtime', 'shift_swap', 'time_correction', 'attendance_recovery', 'payroll']);

export const config = { path: '/api/workforce/approval-routing' };

export default async function handler(req: Request): Promise<Response> {
  const required = req.method === 'GET' ? ['workforce.employees.view'] : ['workforce.employees.edit'];
  const a = await requireWorkforce(req, required);
  if (!a.ok) return a.res;
  const sql = db();
  if (req.method === 'GET') {
    const [policies, delegations] = await Promise.all([
      sql`SELECT * FROM public.workforce_approval_policies WHERE client_id = ${a.ctx.clientId}::uuid ORDER BY request_type` as Promise<unknown[]>,
      sql`
        SELECT d.*, owner.display_name AS owner_name, delegate.display_name AS delegate_name
        FROM public.workforce_approval_delegations d
        JOIN public.user_nodes owner ON owner.id = d.owner_user_node_id
        JOIN public.user_nodes delegate ON delegate.id = d.delegate_user_node_id
        WHERE d.client_id = ${a.ctx.clientId}::uuid
        ORDER BY d.revoked_at NULLS FIRST, d.starts_at DESC
      ` as Promise<unknown[]>,
    ]);
    return jsonOk({ policies, delegations });
  }
  if (req.method === 'DELETE') {
    const delegationId = new URL(req.url).searchParams.get('delegation_id')?.trim() ?? '';
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(delegationId)) return jsonError(400, 'delegation_id_invalid');
    const rows = await sql`
      UPDATE public.workforce_approval_delegations
      SET revoked_at = now(), revoked_by = ${a.ctx.userNodeId}::uuid
      WHERE id = ${delegationId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND revoked_at IS NULL
      RETURNING request_type, owner_user_node_id
    ` as Array<{ request_type: string; owner_user_node_id: string }>;
    if (!rows[0]) return jsonError(404, 'delegation_not_found_or_revoked');
    await sql`
      INSERT INTO public.workforce_approval_routing_events (client_id, request_type, event_type, owner_user_node_id, actor_user_node_id, details)
      VALUES (${a.ctx.clientId}::uuid, ${rows[0].request_type}::text, 'revoked', ${rows[0].owner_user_node_id}::uuid, ${a.ctx.userNodeId}::uuid, jsonb_build_object('delegation_id', ${delegationId}::uuid))
    `;
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return jsonError(400, 'invalid_json'); }
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const type = typeof body.request_type === 'string' ? body.request_type : '';
  if (!TYPES.has(type)) return jsonError(400, 'approval_request_type_invalid');
  if (kind === 'policy') {
    const ownerId = typeof body.primary_approver_user_node_id === 'string' && body.primary_approver_user_node_id.trim() ? body.primary_approver_user_node_id.trim() : null;
    const hours = Number(body.response_target_hours ?? 24);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) return jsonError(400, 'response_target_hours_invalid');
    if (ownerId) {
      const owner = await sql`SELECT id FROM public.user_nodes WHERE id = ${ownerId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1` as unknown[];
      if (!owner[0]) return jsonError(400, 'primary_approver_not_in_workspace');
    }
    const rows = await sql`
      INSERT INTO public.workforce_approval_policies (client_id, request_type, primary_approver_user_node_id, response_target_hours, active, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${type}::text, ${ownerId}::uuid, ${hours}::int, ${body.active !== false}::boolean, ${a.ctx.userNodeId}::uuid)
      ON CONFLICT (client_id, request_type)
      DO UPDATE SET primary_approver_user_node_id = EXCLUDED.primary_approver_user_node_id, response_target_hours = EXCLUDED.response_target_hours, active = EXCLUDED.active, updated_at = now()
      RETURNING *
    ` as Array<Record<string, unknown>>;
    await sql`
      INSERT INTO public.workforce_approval_routing_events (client_id, request_type, event_type, owner_user_node_id, actor_user_node_id, details)
      VALUES (${a.ctx.clientId}::uuid, ${type}::text, 'policy_saved', ${ownerId}::uuid, ${a.ctx.userNodeId}::uuid, jsonb_build_object('response_target_hours', ${hours}::int))
    `;
    return jsonOk({ policy: rows[0] });
  }
  if (kind !== 'delegation') return jsonError(400, 'approval_routing_kind_invalid');
  const ownerId = typeof body.owner_user_node_id === 'string' ? body.owner_user_node_id.trim() : '';
  const delegateId = typeof body.delegate_user_node_id === 'string' ? body.delegate_user_node_id.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const endsAt = typeof body.ends_at === 'string' && body.ends_at.trim() ? body.ends_at : null;
  if (!ownerId || !delegateId || ownerId === delegateId || reason.length < 3) return jsonError(400, 'delegation_invalid');
  if (endsAt && (Number.isNaN(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.now())) return jsonError(400, 'delegation_end_invalid');
  const members = await sql`
    SELECT id
    FROM public.user_nodes
    WHERE client_id = ${a.ctx.clientId}::uuid AND id IN (${ownerId}::uuid, ${delegateId}::uuid)
  ` as unknown[];
  if (members.length !== 2) return jsonError(400, 'delegation_member_not_in_workspace');
  const rows = await sql`
    INSERT INTO public.workforce_approval_delegations (client_id, owner_user_node_id, delegate_user_node_id, request_type, ends_at, reason)
    VALUES (${a.ctx.clientId}::uuid, ${ownerId}::uuid, ${delegateId}::uuid, ${type}::text, ${endsAt}::timestamptz, ${reason}::text)
    RETURNING *
  ` as Array<Record<string, unknown>>;
  await sql`
    INSERT INTO public.workforce_approval_routing_events (client_id, request_type, event_type, owner_user_node_id, actor_user_node_id, details)
    VALUES (${a.ctx.clientId}::uuid, ${type}::text, 'delegated', ${ownerId}::uuid, ${a.ctx.userNodeId}::uuid, jsonb_build_object('delegate_user_node_id', ${delegateId}::uuid, 'reason', ${reason}::text))
  `;
  return jsonOk({ delegation: rows[0] }, { status: 201 });
}

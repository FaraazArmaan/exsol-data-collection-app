// POST /api/finance/approval-decide/:id — approve or reject a pending expense.
// Only a 'pending' expense can be decided (the WHERE clause also enforces client
// scope, so a cross-tenant or already-decided id reads as 404 — no double-decide).
// Writes the decision + approver + note, and logs an audit-trail entry.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { ApprovalDecision } from './_finance-validators';
import { logAudit } from './_shared/audit';
import type { AnySession } from './_shared/permissions';

export const config = { path: '/api/finance/approval-decide/:id', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const a = await requireFinance(req, ['finance.business.edit']);
  if (!a.ok) return a.res;

  let body: ApprovalDecision;
  try {
    body = ApprovalDecision.parse(await req.json());
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  const sql = db();
  const newStatus = body.decision === 'approve' ? 'approved' : 'rejected';
  const rows = (await sql`
    UPDATE public.finance_expenses
       SET approval_status = ${newStatus},
           approved_by     = ${a.ctx.userNodeId}::uuid,
           approved_at     = now(),
           approval_note   = ${body.note ?? null},
           updated_at      = now()
     WHERE id = ${id}::uuid
       AND client_id = ${a.ctx.clientId}::uuid
       AND approval_status = 'pending'
     RETURNING id, category, amount_base_cents
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');

  // Audit trail — session shape for logAudit (level_number is unused by audit).
  const session: AnySession = {
    kind: 'bucket_user', user_node_id: a.ctx.userNodeId, client_id: a.ctx.clientId, level_number: 1,
  };
  await logAudit(sql, {
    session,
    op: `finance.expense.${newStatus}`,
    clientId: a.ctx.clientId,
    targetType: 'finance_expense',
    targetId: id,
    detail: {
      decision: body.decision,
      note: body.note ?? null,
      category: rows[0].category,
      amount_base_cents: Number(rows[0].amount_base_cents),
    },
  });

  return jsonOk({ id, approval_status: newStatus });
}

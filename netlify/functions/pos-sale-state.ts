// POST /api/pos/sales/:id/state — FSM state transition for a sale.
//
// Behavior (spec §5):
//   - Requires pos.history.view to even reach the handler (so we can fetch the sale).
//   - applyTransition() enforces the per-action permission (pos.sale.<action>) and
//     legality of the from→to transition. §5.3 precedence: missing perm wins over
//     illegal-state → 403 returned before 409.
//   - markPaid additionally requires `paymentMethod` in the body; this 422 check
//     fires AFTER the perm/state checks (so a no-perm caller still gets 403, not
//     422 — matches UI tooltip precedence per the API/UI error precedence rule).
//   - Side-effect: instore + markPaid auto-advances to `fulfilled` and stamps
//     both paid_at and fulfilled_at (FSM's `alsoPaid` flag). Two audit rows are
//     written in that case — one for markPaid, one for the auto fulfill.
//   - Timestamp columns: paid_at / fulfilled_at / cancelled_at / refunded_at —
//     we COALESCE so we only set the column relevant to this transition and
//     leave the others untouched.
//   - Cross-client/non-existent → 404 (consistent with sale-detail's leak guard).
//
// Routing: '/api/pos/sales/:id/state'. URL extraction takes the second-to-last
// segment (paths in tests are `/api/pos/sales/<id>/state` with no trailing slash).
//
// Audit:
//   - `audit_log.occurred_at` is the timestamp column (per mig 025); logAudit
//     writes it via DB default — we don't pass it explicitly.
//   - op convention: `pos.sale.<action>` (matches `pos.sale.created` from create).

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { requirePos } from './_pos-authz';
import { SaleStateBody } from './_pos-validators';
import { applyTransition, FSM_ERROR, type SaleStatus, type SaleChannel } from './_pos-fsm';

export const config = { path: '/api/pos/sales/:id/state' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.history.view']);
  if (!a.ok) return a.res;

  // URL: /api/pos/sales/:id/state — id is second-to-last segment.
  const segments = new URL(req.url).pathname.split('/');
  const id = segments[segments.length - 2] ?? '';
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  let body: SaleStateBody;
  try {
    body = SaleStateBody.parse(await req.json());
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  const sql = db();
  const sales = (await sql`
    SELECT id, status, channel FROM public.sales
    WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
  `) as Array<{ id: string; status: SaleStatus; channel: SaleChannel }>;
  const sale = sales[0];
  if (!sale) return jsonError(404, 'not_found');

  const result = applyTransition({
    from: sale.status,
    channel: sale.channel,
    action: body.action,
    perms: a.ctx.perms,
  });
  if (!result.ok) {
    if (result.code === FSM_ERROR.MISSING_PERM) return jsonError(403, 'missing_permission');
    return jsonError(409, 'illegal_transition');
  }

  // 422 fires AFTER perm + state checks (spec §5.3 precedence).
  if (body.action === 'markPaid' && !body.paymentMethod) {
    return jsonError(422, 'payment_method_required');
  }

  const nowIso = new Date().toISOString();
  const wantPaid = body.action === 'markPaid';
  const wantFulfill = body.action === 'fulfill' || (wantPaid && result.alsoPaid);
  const wantCancel = body.action === 'cancel';
  const wantRefund = body.action === 'refund';

  // Single UPDATE sets new status + only the timestamps relevant to this action.
  // COALESCE preserves prior timestamps for unrelated columns.
  await sql`
    UPDATE public.sales SET
      status         = ${result.to}::sale_status,
      paid_at        = COALESCE(${wantPaid    ? nowIso : null}::timestamptz, paid_at),
      fulfilled_at   = COALESCE(${wantFulfill ? nowIso : null}::timestamptz, fulfilled_at),
      cancelled_at   = COALESCE(${wantCancel  ? nowIso : null}::timestamptz, cancelled_at),
      refunded_at    = COALESCE(${wantRefund  ? nowIso : null}::timestamptz, refunded_at),
      payment_method = COALESCE(${wantPaid ? body.paymentMethod ?? null : null}, payment_method)
    WHERE id = ${id}::uuid
  `;

  // Audit primary action; instore+markPaid also writes the auto-fulfill row.
  // logAudit only reads kind + user_node_id (no level column), so we don't
  // carry a (previously hardcoded) level_number — it would misrepresent L2+.
  const session = {
    kind: 'bucket_user',
    user_node_id: a.ctx.userNodeId,
    client_id: a.ctx.clientId,
  } as any;
  await logAudit(sql, {
    session,
    op: `pos.sale.${body.action}`,
    clientId: a.ctx.clientId,
    targetType: 'sale',
    targetId: id,
    detail: {
      from: sale.status,
      to: result.alsoPaid ? 'paid' : result.to,
      reason: body.reason ?? null,
    },
  });
  if (result.alsoPaid) {
    await logAudit(sql, {
      session,
      op: 'pos.sale.fulfill',
      clientId: a.ctx.clientId,
      targetType: 'sale',
      targetId: id,
      detail: { from: 'paid', to: 'fulfilled', auto: true },
    });
  }

  const updated = (await sql`SELECT * FROM public.sales WHERE id = ${id}::uuid`) as any[];
  return jsonOk(updated[0]);
}

import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { ordersAuditSession, requireOrders } from './_orders-authz';
import { readWarehouseEvidence, type WarehouseEvidence } from './_orders-warehouse-service';

export const config = { path: '/api/orders/warehouse-execution-consume', method: 'POST' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FULFILLMENT_STEPS = { pick: ['pending', 'picked', 'picking'], pack: ['picked', 'packed', 'packing'], handoff: ['packed', 'shipped', 'shipped'] } as const;

function latest(evidence: WarehouseEvidence[], kind: string) {
  return evidence.filter((item) => item.kind === kind).at(-1) ?? null;
}

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;
  const body = await req.json().catch(() => null) as { fulfillment_id?: unknown; return_case_id?: unknown; kind?: unknown } | null;
  const fulfillmentId = typeof body?.fulfillment_id === 'string' ? body.fulfillment_id : '';
  const returnCaseId = typeof body?.return_case_id === 'string' ? body.return_case_id : '';
  const kind = typeof body?.kind === 'string' ? body.kind : '';
  if ((!!fulfillmentId) === (!!returnCaseId) || !UUID.test(fulfillmentId || returnCaseId)) return jsonError(400, 'invalid_body');
  if (fulfillmentId && !(kind in FULFILLMENT_STEPS)) return jsonError(400, 'invalid_body');
  if (returnCaseId && kind !== 'return_intake') return jsonError(400, 'invalid_body');

  const sql = db();
  const source = fulfillmentId
    ? await sql`SELECT id,status,sale_id FROM public.orders_fulfillments WHERE id=${fulfillmentId}::uuid AND client_id=${a.ctx.clientId}::uuid LIMIT 1`
    : await sql`SELECT id,status,sale_id FROM public.orders_return_cases WHERE id=${returnCaseId}::uuid AND client_id=${a.ctx.clientId}::uuid LIMIT 1`;
  if (!source[0]) return jsonError(404, 'not_found');
  const lineRows = (fulfillmentId
    ? await sql`SELECT id FROM public.orders_fulfillment_lines WHERE fulfillment_id=${fulfillmentId}::uuid`
    : await sql`SELECT id FROM public.orders_return_case_lines WHERE return_case_id=${returnCaseId}::uuid`) as Array<{ id: string }>;
  const all = await Promise.all(lineRows.map((line) => readWarehouseEvidence(req, a.ctx.clientId, fulfillmentId ? { fulfillment_line_id: line.id } : { return_case_line_id: line.id })));
  const unavailable = all.find((result) => !result.ok);
  if (unavailable && !unavailable.ok) return jsonError(unavailable.status, unavailable.code);
  const terminal = all.map((result) => latest((result as Extract<typeof result, { ok: true }>).value.evidence, kind));
  if (terminal.some((item) => !item)) return jsonError(409, 'warehouse_evidence_pending');
  const exception = terminal.find((item) => item?.outcome === 'exception');
  if (exception) return jsonError(409, 'warehouse_execution_exception', { task_id: exception.task_id });

  const current = source[0] as { id: string; status: string; sale_id: string };
  if (fulfillmentId) {
    const [from, to, stage] = FULFILLMENT_STEPS[kind as keyof typeof FULFILLMENT_STEPS];
    if (current.status === to) return jsonOk({ id: fulfillmentId, status: to, replayed: true });
    if (current.status !== from) return jsonError(409, 'illegal_transition', { from: current.status, to });
    await sql.transaction([
      sql`UPDATE public.orders_fulfillments SET status=${to}::fulfillment_status,updated_at=now() WHERE id=${fulfillmentId}::uuid AND status=${from}::fulfillment_status`,
      sql`INSERT INTO public.orders_stage_events (client_id,sale_id,stage,source) VALUES (${a.ctx.clientId}::uuid,${current.sale_id}::uuid,${stage}::order_stage,'warehouse')`,
    ]);
    await logAudit(sql, { session: ordersAuditSession(a.ctx), op: `orders.fulfillment.warehouse_${kind}`, clientId: a.ctx.clientId, targetType: 'fulfillment', targetId: fulfillmentId, detail: { task_ids: terminal.map((item) => item!.task_id) } });
    return jsonOk({ id: fulfillmentId, status: to });
  }
  if (current.status === 'awaiting_receipt') return jsonOk({ id: returnCaseId, status: 'awaiting_receipt', replayed: true });
  if (current.status !== 'authorized') return jsonError(409, 'return_not_receivable');
  await sql`UPDATE public.orders_return_cases SET status='awaiting_receipt',updated_at=now() WHERE id=${returnCaseId}::uuid AND status='authorized'`;
  await logAudit(sql, { session: ordersAuditSession(a.ctx), op: 'orders.return.warehouse_intake_received', clientId: a.ctx.clientId, targetType: 'orders_return_case', targetId: returnCaseId, detail: { task_ids: terminal.map((item) => item!.task_id) } });
  return jsonOk({ id: returnCaseId, status: 'awaiting_receipt' });
}

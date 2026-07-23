import { db } from './_shared/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTBOUND_KINDS = new Set(['pick', 'pack', 'handoff', 'return_intake']);

export type ExecutionTaskRequest = {
  client_id: string;
  kind: string;
  idempotency_key: string;
  fulfillment_line_id?: string;
  return_case_line_id?: string;
  location_id?: string;
  qty?: number;
};

type TaskResult =
  | { ok: true; created: boolean; task: Record<string, unknown> }
  | { ok: false; status: number; code: string };

export async function requestOrdersExecutionTask(input: unknown): Promise<TaskResult> {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Partial<ExecutionTaskRequest> : {};
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const key = typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
  const fulfillmentLineId = typeof body.fulfillment_line_id === 'string' ? body.fulfillment_line_id : null;
  const returnCaseLineId = typeof body.return_case_line_id === 'string' ? body.return_case_line_id : null;
  const locationId = typeof body.location_id === 'string' ? body.location_id : null;
  const isReturn = kind === 'return_intake';
  if (!UUID.test(clientId) || !OUTBOUND_KINDS.has(kind) || !key || (!!fulfillmentLineId) === (!!returnCaseLineId) || isReturn !== !!returnCaseLineId) return { ok: false, status: 400, code: 'invalid_task_origin' };
  if ((fulfillmentLineId && !UUID.test(fulfillmentLineId)) || (returnCaseLineId && !UUID.test(returnCaseLineId)) || (locationId && !UUID.test(locationId))) return { ok: false, status: 400, code: 'invalid_task_origin' };
  if (body.qty !== undefined && (!Number.isInteger(body.qty) || body.qty < 1)) return { ok: false, status: 400, code: 'invalid_task_qty' };

  const sql = db();
  const prior = (await sql`SELECT * FROM public.warehouse_execution_tasks WHERE client_id=${clientId}::uuid AND idempotency_key=${key} LIMIT 1`) as Array<Record<string, unknown>>;
  if (prior[0]) return { ok: true, created: false, task: prior[0] };
  const source = fulfillmentLineId
    ? (await sql`SELECT f.id fulfillment_id,l.id line_id,p.id product_id,l.qty FROM public.orders_fulfillment_lines l JOIN public.orders_fulfillments f ON f.id=l.fulfillment_id JOIN public.sale_lines sl ON sl.id=l.sale_line_id JOIN public.products p ON p.id=sl.product_id WHERE l.id=${fulfillmentLineId}::uuid AND f.client_id=${clientId}::uuid LIMIT 1`) as Array<{ fulfillment_id: string; line_id: string; product_id: string; qty: number }>
    : (await sql`SELECT c.id return_case_id,l.id line_id,p.id product_id,l.qty FROM public.orders_return_case_lines l JOIN public.orders_return_cases c ON c.id=l.return_case_id JOIN public.sale_lines sl ON sl.id=l.sale_line_id JOIN public.products p ON p.id=sl.product_id WHERE l.id=${returnCaseLineId}::uuid AND c.client_id=${clientId}::uuid AND c.status IN ('authorized','awaiting_receipt') LIMIT 1`) as Array<{ return_case_id: string; line_id: string; product_id: string; qty: number }>;
  const s = source[0];
  if (!s) return { ok: false, status: 404, code: 'authorised_origin_not_found' };
  const qty = body.qty ?? Number(s.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > Number(s.qty)) return { ok: false, status: 400, code: 'invalid_task_qty' };
  if (locationId) {
    const location = await sql`SELECT id FROM public.warehouse_locations WHERE id=${locationId}::uuid AND client_id=${clientId}::uuid LIMIT 1`;
    if (!location[0]) return { ok: false, status: 404, code: 'location_not_found' };
  }
  try {
    const rows = (await sql`INSERT INTO public.warehouse_execution_tasks (client_id,kind,idempotency_key,fulfillment_id,fulfillment_line_id,return_case_id,return_case_line_id,product_id,location_id,qty) VALUES (${clientId}::uuid,${kind},${key},${'fulfillment_id' in s ? s.fulfillment_id : null}::uuid,${fulfillmentLineId}::uuid,${'return_case_id' in s ? s.return_case_id : null}::uuid,${returnCaseLineId}::uuid,${s.product_id}::uuid,${locationId}::uuid,${qty}::int) RETURNING *`) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new Error('warehouse_execution_task_missing');
    return { ok: true, created: true, task: rows[0] };
  } catch (error: any) {
    if (error?.code !== '23505') throw error;
    const replay = (await sql`SELECT * FROM public.warehouse_execution_tasks WHERE client_id=${clientId}::uuid AND idempotency_key=${key} LIMIT 1`) as Array<Record<string, unknown>>;
    if (!replay[0]) throw error;
    return { ok: true, created: false, task: replay[0] };
  }
}

export function executionEvidence(task: Record<string, unknown>) {
  const outcome = task.status === 'completed' || task.status === 'exception' ? task.status : null;
  return {
    task_id: task.id,
    fulfillment_id: task.fulfillment_id,
    fulfillment_line_id: task.fulfillment_line_id,
    return_case_id: task.return_case_id,
    return_case_line_id: task.return_case_line_id,
    kind: task.kind,
    outcome,
    completed_quantity: outcome === 'completed' ? Number(task.qty) : 0,
    evidence: task.completion_evidence,
    actor_id: task.completed_by,
    completed_at: task.completed_at,
    correlation_id: task.idempotency_key,
    location_id: task.location_id,
  };
}

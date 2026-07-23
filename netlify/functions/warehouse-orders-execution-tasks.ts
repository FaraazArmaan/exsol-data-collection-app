import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { executionEvidence, requestOrdersExecutionTask } from './_warehouse-execution-tasks';
import { requireOrdersWarehouseService } from './_warehouse-orders-service';

export const config = { path: '/api/internal/orders/warehouse-execution-tasks', method: ['GET', 'POST'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const service = requireOrdersWarehouseService(req);
  if (!service.ok) return service.res;
  if (req.method === 'POST') {
    let body: unknown;
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const result = await requestOrdersExecutionTask(body);
    if (!result.ok) return jsonError(result.status, result.code);
    return jsonOk({ task: result.task, replayed: !result.created }, { status: result.created ? 201 : 200 });
  }
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id') ?? '';
  const fulfillmentLineId = url.searchParams.get('fulfillment_line_id');
  const returnCaseLineId = url.searchParams.get('return_case_line_id');
  if (!UUID.test(clientId) || (!!fulfillmentLineId) === (!!returnCaseLineId) || (fulfillmentLineId && !UUID.test(fulfillmentLineId)) || (returnCaseLineId && !UUID.test(returnCaseLineId))) return jsonError(400, 'invalid_evidence_scope');
  const sql = db();
  const rows = (await sql`SELECT * FROM public.warehouse_execution_tasks WHERE client_id=${clientId}::uuid AND status IN ('completed','exception') AND (fulfillment_line_id=${fulfillmentLineId ?? null}::uuid OR return_case_line_id=${returnCaseLineId ?? null}::uuid) ORDER BY completed_at ASC, id ASC`) as Array<Record<string, unknown>>;
  return jsonOk({ evidence: rows.map(executionEvidence) });
}

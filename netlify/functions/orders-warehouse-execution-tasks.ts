import { jsonError, jsonOk } from './_shared/http';
import { requireOrders } from './_orders-authz';
import { readWarehouseEvidence, requestWarehouseTask } from './_orders-warehouse-service';

export const config = { path: '/api/orders/warehouse-execution-tasks', method: ['GET', 'POST'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, [req.method === 'POST' ? 'orders.business.create' : 'orders.business.view']);
  if (!a.ok) return a.res;
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError(400, 'invalid_body');
    const result = await requestWarehouseTask(req, { ...(body as Record<string, unknown>), client_id: a.ctx.clientId });
    return result.ok ? jsonOk(result.value, { status: result.value.replayed ? 200 : 201 }) : jsonError(result.status, result.code);
  }
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const url = new URL(req.url);
  const fulfillmentLineId = url.searchParams.get('fulfillment_line_id') ?? '';
  const returnCaseLineId = url.searchParams.get('return_case_line_id') ?? '';
  if ((!!fulfillmentLineId) === (!!returnCaseLineId) || !UUID.test(fulfillmentLineId || returnCaseLineId)) return jsonError(400, 'invalid_evidence_scope');
  const result = await readWarehouseEvidence(req, a.ctx.clientId, fulfillmentLineId ? { fulfillment_line_id: fulfillmentLineId } : { return_case_line_id: returnCaseLineId });
  return result.ok ? jsonOk(result.value) : jsonError(result.status, result.code);
}

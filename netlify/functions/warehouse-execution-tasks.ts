import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';
export const config = { path: '/api/warehouse/execution-tasks', method: ['GET', 'POST'] };
export default async function handler(req: Request): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.products.view']);
  if (!a.ok) return a.res;
  const sql = db();
  if (req.method === 'GET') return jsonOk({ tasks: await sql`SELECT * FROM public.warehouse_execution_tasks WHERE client_id=${a.ctx.clientId}::uuid ORDER BY created_at DESC` });
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  return jsonError(403, 'orders_origin_required');
}

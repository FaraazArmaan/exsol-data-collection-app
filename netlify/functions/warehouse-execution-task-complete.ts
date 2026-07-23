import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';
export const config = { path: '/api/warehouse/execution-task-complete', method: 'POST' };
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const a = await requireWarehouse(req, ['warehouse.products.edit']);
  if (!a.ok) return a.res;
  let b:any; try { b=await req.json(); } catch { return jsonError(400,'invalid_json'); }
  const id=typeof b.task_id==='string'?b.task_id:'';
  const outcome=b.outcome==='exception'?'exception':b.outcome==='completed'?'completed':'';
  if (!id || !outcome) return jsonError(400,'invalid_completion');
  const evidence=b.evidence && typeof b.evidence==='object' && !Array.isArray(b.evidence)?b.evidence:{};
  const sql=db();
  const task=await sql`SELECT * FROM public.warehouse_execution_tasks WHERE id=${id}::uuid AND client_id=${a.ctx.clientId}::uuid LIMIT 1`;
  if (!task[0]) return jsonError(404,'task_not_found');
  if (task[0].status==='completed' || task[0].status==='exception') return jsonOk({ task:task[0], replayed:true });
  const rows=await sql`UPDATE public.warehouse_execution_tasks SET status=${outcome}, completion_evidence=${JSON.stringify(evidence)}::jsonb, completed_by=${a.ctx.userNodeId}::uuid, completed_at=now(), updated_at=now() WHERE id=${id}::uuid AND status IN ('pending','in_progress') RETURNING *`;
  if (rows[0]) return jsonOk({ task:rows[0] });
  const current=await sql`SELECT * FROM public.warehouse_execution_tasks WHERE id=${id}::uuid AND client_id=${a.ctx.clientId}::uuid LIMIT 1`;
  if (current[0]?.status==='completed' || current[0]?.status==='exception') return jsonOk({ task:current[0], replayed:true });
  return jsonError(409,'task_update_conflict');
}

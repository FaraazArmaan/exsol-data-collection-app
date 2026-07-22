import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/returns', method: ['GET', 'POST'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReturnLineInput = { sale_line_id?: unknown; qty?: unknown; reason?: unknown };
type SaleLine = { id: string; qty: number; status: string };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, [req.method === 'POST' ? 'orders.business.create' : 'orders.business.view']);
  if (!a.ok) return a.res;
  const sql = db();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT c.*, s.order_no, s.customer_name,
        COALESCE(json_agg(json_build_object('id', l.id, 'sale_line_id', l.sale_line_id, 'qty', l.qty, 'reason', l.reason)) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
      FROM public.orders_return_cases c
      JOIN public.sales s ON s.id=c.sale_id
      LEFT JOIN public.orders_return_case_lines l ON l.return_case_id=c.id
      WHERE c.client_id=${a.ctx.clientId}::uuid
      GROUP BY c.id, s.order_no, s.customer_name
      ORDER BY c.created_at DESC
    `;
    return jsonOk(rows);
  }
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: { sale_id?: unknown; lines?: unknown; reason?: unknown; idempotency_key?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_body'); }
  const saleId = typeof body.sale_id === 'string' ? body.sale_id : '';
  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
  const lines = Array.isArray(body.lines) ? body.lines as ReturnLineInput[] : [];
  if (!UUID.test(saleId) || !idempotencyKey || lines.length === 0) return jsonError(400, 'invalid_body');

  const existing = await sql`SELECT * FROM public.orders_return_cases WHERE client_id=${a.ctx.clientId}::uuid AND idempotency_key=${idempotencyKey} LIMIT 1`;
  if (existing[0]) return jsonOk(existing[0]);

  const lineIds = lines.map((line) => typeof line.sale_line_id === 'string' ? line.sale_line_id : '');
  if (lineIds.some((id) => !UUID.test(id)) || new Set(lineIds).size !== lineIds.length) return jsonError(400, 'invalid_lines');
  const saleLines = await sql`
    SELECT line.id, line.qty, sale.status
    FROM public.sale_lines line
    JOIN public.sales sale ON sale.id=line.sale_id
    WHERE line.sale_id=${saleId}::uuid AND sale.bucket_id=${a.ctx.clientId}::uuid AND line.id=ANY(${lineIds}::uuid[])
  ` as SaleLine[];
  if (saleLines.length !== lines.length) return jsonError(404, 'sale_line_not_found');
  if (saleLines[0]?.status !== 'fulfilled') return jsonError(409, 'return_not_eligible');

  const requested = new Map<string, number>();
  for (const line of lines) {
    const qty = line.qty;
    const saleLine = saleLines.find((candidate) => candidate.id === line.sale_line_id);
    if (!Number.isInteger(qty) || typeof qty !== 'number' || qty < 1 || qty > Number(saleLine?.qty ?? 0)) return jsonError(400, 'invalid_qty');
    requested.set(saleLine!.id, qty);
  }
  const previouslyReturned = await sql`
    SELECT line.sale_line_id, COALESCE(SUM(line.qty), 0)::int AS qty
    FROM public.orders_return_case_lines line
    JOIN public.orders_return_cases c ON c.id=line.return_case_id
    WHERE line.sale_line_id=ANY(${lineIds}::uuid[]) AND c.status <> 'refused'
    GROUP BY line.sale_line_id
  ` as Array<{ sale_line_id: string; qty: number }>;
  for (const saleLine of saleLines) {
    const used = Number(previouslyReturned.find((line) => line.sale_line_id === saleLine.id)?.qty ?? 0);
    if (used + requested.get(saleLine.id)! > Number(saleLine.qty)) return jsonError(409, 'return_qty_exceeds_fulfilled');
  }

  const caseId = crypto.randomUUID();
  const results = await sql.transaction([
    sql`
      INSERT INTO public.orders_return_cases (id,client_id,sale_id,request_reason,requested_by,idempotency_key)
      VALUES (${caseId}::uuid,${a.ctx.clientId}::uuid,${saleId}::uuid,${typeof body.reason === 'string' ? body.reason : null},${a.ctx.userNodeId}::uuid,${idempotencyKey})
      RETURNING *
    `,
    ...lines.map((line) => sql`
      INSERT INTO public.orders_return_case_lines (return_case_id,sale_line_id,qty,reason)
      VALUES (${caseId}::uuid,${line.sale_line_id as string}::uuid,${line.qty as number},${typeof line.reason === 'string' ? line.reason : null})
    `),
  ]);
  const created = (results[0] as Array<Record<string, unknown>>)[0];
  if (!created) throw new Error('return_case_insert_missing');
  await logAudit(sql, {
    session: ordersAuditSession(a.ctx), op: 'orders.return.requested', clientId: a.ctx.clientId,
    targetType: 'orders_return_case', targetId: caseId,
  });
  return jsonOk(created, { status: 201 });
}

import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { ordersAuditSession, type OrdersAuthCtx } from './_orders-authz';
import type { AnySession } from './_shared/permissions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReturnLineInput = { sale_line_id?: unknown; qty?: unknown; reason?: unknown };
type SaleLine = { id: string; qty: number; status: string };

export type CreateOrdersReturnCaseInput = {
  sale_id?: unknown;
  lines?: unknown;
  reason?: unknown;
  idempotency_key?: unknown;
};

export type CreateOrdersReturnCaseResult =
  | { ok: true; created: boolean; returnCase: Record<string, unknown> }
  | { ok: false; status: number; code: string };

export type OrdersReturnCaseActor = {
  clientId: string;
  userNodeId: string | null;
  auditSession: AnySession;
  source: 'staff' | 'storefront';
};

export function ordersReturnCaseActor(ctx: OrdersAuthCtx): OrdersReturnCaseActor {
  return {
    clientId: ctx.clientId,
    userNodeId: ctx.userNodeId,
    auditSession: ordersAuditSession(ctx),
    source: 'staff',
  };
}

export async function createOrdersReturnCase(
  actor: OrdersReturnCaseActor,
  body: unknown,
): Promise<CreateOrdersReturnCaseResult> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { ok: false, status: 400, code: 'invalid_body' };
  const input = body as CreateOrdersReturnCaseInput;
  const saleId = typeof input.sale_id === 'string' ? input.sale_id : '';
  const idempotencyKey = typeof input.idempotency_key === 'string' ? input.idempotency_key : '';
  const lines = Array.isArray(input.lines) ? (input.lines as ReturnLineInput[]) : [];
  if (!UUID.test(saleId) || !idempotencyKey || lines.length === 0)
    return { ok: false, status: 400, code: 'invalid_body' };

  const sql = db();
  const existing =
    (await sql`SELECT * FROM public.orders_return_cases WHERE client_id=${actor.clientId}::uuid AND idempotency_key=${idempotencyKey} LIMIT 1`) as Array<
      Record<string, unknown>
    >;
  if (existing[0]) {
    if (existing[0].sale_id !== saleId)
      return { ok: false, status: 409, code: 'idempotency_key_conflict' };
    return { ok: true, created: false, returnCase: existing[0] };
  }

  const lineIds = lines.map((line) =>
    typeof line.sale_line_id === 'string' ? line.sale_line_id : '',
  );
  if (lineIds.some((id) => !UUID.test(id)) || new Set(lineIds).size !== lineIds.length)
    return { ok: false, status: 400, code: 'invalid_lines' };
  const saleLines = (await sql`
    SELECT line.id, line.qty, sale.status
    FROM public.sale_lines line
    JOIN public.sales sale ON sale.id=line.sale_id
    WHERE line.sale_id=${saleId}::uuid AND sale.bucket_id=${actor.clientId}::uuid AND line.id=ANY(${lineIds}::uuid[])
  `) as SaleLine[];
  if (saleLines.length !== lines.length)
    return { ok: false, status: 404, code: 'sale_line_not_found' };
  if (saleLines[0]?.status !== 'fulfilled')
    return { ok: false, status: 409, code: 'return_not_eligible' };

  const requested = new Map<string, number>();
  for (const line of lines) {
    const qty = line.qty;
    const saleLine = saleLines.find((candidate) => candidate.id === line.sale_line_id);
    if (
      !Number.isInteger(qty) ||
      typeof qty !== 'number' ||
      qty < 1 ||
      qty > Number(saleLine?.qty ?? 0)
    )
      return { ok: false, status: 400, code: 'invalid_qty' };
    requested.set(saleLine!.id, qty);
  }
  const previouslyReturned = (await sql`
    SELECT line.sale_line_id, COALESCE(SUM(line.qty), 0)::int AS qty
    FROM public.orders_return_case_lines line
    JOIN public.orders_return_cases c ON c.id=line.return_case_id
    WHERE line.sale_line_id=ANY(${lineIds}::uuid[]) AND c.status <> 'refused'
    GROUP BY line.sale_line_id
  `) as Array<{ sale_line_id: string; qty: number }>;
  for (const saleLine of saleLines) {
    const used = Number(
      previouslyReturned.find((line) => line.sale_line_id === saleLine.id)?.qty ?? 0,
    );
    if (used + requested.get(saleLine.id)! > Number(saleLine.qty))
      return { ok: false, status: 409, code: 'return_qty_exceeds_fulfilled' };
  }

  const caseId = crypto.randomUUID();
  const results = await sql.transaction([
    sql`
      INSERT INTO public.orders_return_cases (id,client_id,sale_id,request_reason,requested_by,idempotency_key)
      VALUES (${caseId}::uuid,${actor.clientId}::uuid,${saleId}::uuid,${typeof input.reason === 'string' ? input.reason : null},${actor.userNodeId}::uuid,${idempotencyKey})
      RETURNING *
    `,
    ...lines.map(
      (line) => sql`
      INSERT INTO public.orders_return_case_lines (return_case_id,sale_line_id,qty,reason)
      VALUES (${caseId}::uuid,${line.sale_line_id as string}::uuid,${line.qty as number},${typeof line.reason === 'string' ? line.reason : null})
    `,
    ),
  ]);
  const created = (results[0] as Array<Record<string, unknown>>)[0];
  if (!created) throw new Error('return_case_insert_missing');
  await logAudit(sql, {
    session: actor.auditSession,
    op: 'orders.return.requested',
    clientId: actor.clientId,
    targetType: 'orders_return_case',
    targetId: caseId,
    detail: { source: actor.source },
  });
  return { ok: true, created: true, returnCase: created };
}

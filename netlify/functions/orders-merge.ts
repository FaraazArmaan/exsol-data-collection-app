// POST /api/orders/merge — link same-customer open orders into a merge group.
//
// Body: { primary_sale_id: string, sale_ids: string[] }
// Permission: orders.business.edit
//
// Validation:
//   • All sale_ids must be owned by this client (bucket_id = clientId); else 404.
//   • All sales must be OPEN (status IN ('pending_payment', 'paid')); else 409 sale_not_open.
//   • All sales must have the same customer_phone as the primary; else 409 customer_mismatch.
//
// On success: one sql.transaction inserts orders_merge_groups + one orders_merge_members
//   row per sale (including the primary). customer_key = primary.customer_phone.
//
// Returns 201 { group_id: string }.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/merge', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPEN_STATUSES = new Set(['pending_payment', 'paid']);

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;

  let body: { primary_sale_id?: unknown; sale_ids?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }

  const primarySaleId = typeof body.primary_sale_id === 'string' ? body.primary_sale_id : '';
  if (!UUID_RE.test(primarySaleId)) return jsonError(400, 'invalid_primary_sale_id');

  if (!Array.isArray(body.sale_ids) || body.sale_ids.length === 0) {
    return jsonError(400, 'sale_ids_required');
  }
  const saleIds = (body.sale_ids as unknown[]).filter(
    (id): id is string => typeof id === 'string' && UUID_RE.test(id),
  );
  if (saleIds.length !== (body.sale_ids as unknown[]).length) {
    return jsonError(400, 'invalid_sale_ids');
  }

  const sql = db();

  // Load all requested sales scoped to this client.
  const saleRows = (await sql`
    SELECT id, status, customer_phone
    FROM public.sales
    WHERE id = ANY(${saleIds}::uuid[]) AND bucket_id = ${a.ctx.clientId}::uuid
  `) as Array<{ id: string; status: string; customer_phone: string | null }>;

  // Any sale not found means it's foreign or non-existent → 404.
  if (saleRows.length !== saleIds.length) return jsonError(404, 'not_found');

  const saleMap = new Map(saleRows.map((s) => [s.id, s]));
  const primary = saleMap.get(primarySaleId);
  if (!primary) return jsonError(404, 'not_found');

  // All must be open.
  for (const s of saleRows) {
    if (!OPEN_STATUSES.has(s.status)) {
      return jsonError(409, 'sale_not_open', { sale_id: s.id, status: s.status });
    }
  }

  // All must share the same customer_phone as the primary.
  const primaryPhone = primary.customer_phone;
  for (const s of saleRows) {
    if (s.id !== primarySaleId && s.customer_phone !== primaryPhone) {
      return jsonError(409, 'customer_mismatch', { sale_id: s.id });
    }
  }

  const customerKey = primaryPhone ?? '';
  const { randomUUID } = await import('node:crypto');
  const groupId = randomUUID();

  const queries = [];
  queries.push(sql`
    INSERT INTO public.orders_merge_groups (id, client_id, primary_sale_id, customer_key)
    VALUES (${groupId}::uuid, ${a.ctx.clientId}::uuid, ${primarySaleId}::uuid, ${customerKey})
  `);
  for (const saleId of saleIds) {
    queries.push(sql`
      INSERT INTO public.orders_merge_members (group_id, sale_id)
      VALUES (${groupId}::uuid, ${saleId}::uuid)
    `);
  }

  await sql.transaction(queries);

  await logAudit(sql, {
    session: ordersAuditSession(a.ctx),
    op: 'orders.merge',
    clientId: a.ctx.clientId,
    targetType: 'merge_group',
    targetId: groupId,
    detail: { member_count: saleIds.length },
  });

  return jsonOk({ group_id: groupId }, { status: 201 });
}

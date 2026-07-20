// POST /api/orders/split/:saleId — split a sale's lines into named fulfillment groups.
//
// Body: { fulfillments: [{ label, lines: [{ sale_line_id, qty }] }] }
// Permission: orders.business.edit
//
// Validation (handler-enforced, no DB constraint spans fulfillments):
//   • ≥1 fulfillment in body
//   • every sale_line_id must belong to this sale (else 409)
//   • each line qty > 0
//   • per sale_line, SUM(assigned qty across all fulfillments) ≤ line.qty (else 409 over_fulfillment)
//
// On success: one sql.transaction inserts all fulfillment rows + their fulfillment_lines.
// Returns 201 { fulfillment_ids: string[] }.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders, ordersAuditSession } from './_orders-authz';
import { logAudit } from './_shared/audit';

export const config = { path: '/api/orders/split/:saleId', method: 'POST' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

interface FulfillmentInput {
  label: unknown;
  lines: Array<{ sale_line_id: unknown; qty: unknown }>;
}

export default async function handler(req: Request): Promise<Response> {
  const saleId = idFrom(req);
  if (!UUID_RE.test(saleId)) return jsonError(404, 'not_found');

  const a = await requireOrders(req, ['orders.business.edit']);
  if (!a.ok) return a.res;

  let body: { fulfillments?: unknown };
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }

  if (!Array.isArray(body.fulfillments) || body.fulfillments.length === 0) {
    return jsonError(400, 'fulfillments_required');
  }
  const fulfillments = body.fulfillments as FulfillmentInput[];

  const sql = db();

  // Load sale scoped by bucket_id (= clientId) → 404 if not owned.
  const saleRows = (await sql`
    SELECT id, status, channel FROM public.sales
    WHERE id = ${saleId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string; channel: string }>;
  if (!saleRows[0]) return jsonError(404, 'not_found');
  if (saleRows[0].channel === 'instore') return jsonError(409, 'orders_fulfillment_not_required');
  if (saleRows[0].status !== 'paid') return jsonError(409, 'sale_not_paid');

  // Load all sale_lines for this sale — used for validation.
  const saleLineRows = (await sql`
    SELECT id, qty FROM public.sale_lines WHERE sale_id = ${saleId}::uuid
  `) as Array<{ id: string; qty: number }>;
  const saleLineMap = new Map(saleLineRows.map((r) => [r.id, r.qty]));

  // Load already-allocated qty per sale line from existing (non-cancelled) fulfillments.
  // This turns the per-request check into a per-sale check, preventing cross-request
  // over-fulfillment: without this, split A qty=10 then split B qty=10 on a qty=10 line
  // both pass the per-request guard independently.
  // TOCTOU caveat: concurrent double-split still needs SELECT FOR UPDATE row-locking (deferred).
  const allocatedRows = (await sql`
    SELECT fl.sale_line_id, COALESCE(SUM(fl.qty),0)::int AS allocated
    FROM public.orders_fulfillment_lines fl
    JOIN public.orders_fulfillments f ON f.id = fl.fulfillment_id
    WHERE f.sale_id = ${saleId}::uuid AND f.client_id = ${a.ctx.clientId}::uuid AND f.status <> 'cancelled'
    GROUP BY fl.sale_line_id
  `) as Array<{ sale_line_id: string; allocated: number }>;

  // Validate all line entries and accumulate assigned qty per sale_line_id.
  // Seeded with existing (non-cancelled) allocations so the cap spans prior splits.
  const assignedQty = new Map<string, number>(
    allocatedRows.map((r) => [r.sale_line_id, Number(r.allocated)]),
  );
  for (const f of fulfillments) {
    if (!Array.isArray(f.lines)) return jsonError(400, 'invalid_fulfillment');
    for (const l of f.lines) {
      const slId = typeof l.sale_line_id === 'string' ? l.sale_line_id : '';
      const qty = typeof l.qty === 'number' ? l.qty : 0;
      if (!UUID_RE.test(slId) || !saleLineMap.has(slId)) {
        return jsonError(409, 'invalid_sale_line', { sale_line_id: slId });
      }
      // Reject non-integers: a fractional qty (e.g. 1.5) would silently truncate
      // to 1 in the DB via ::int cast, diverging from what the client expects.
      if (!Number.isInteger(qty) || qty <= 0) return jsonError(400, 'invalid_qty', { sale_line_id: slId });
      assignedQty.set(slId, (assignedQty.get(slId) ?? 0) + qty);
    }
  }

  // Check over-fulfillment: sum(assigned) ≤ line.qty for every sale_line_id used.
  for (const [slId, assigned] of assignedQty) {
    const lineQty = saleLineMap.get(slId) ?? 0;
    if (assigned > lineQty) {
      return jsonError(409, 'over_fulfillment', { sale_line_id: slId });
    }
  }

  // Build the atomic transaction — generate UUIDs here so the test can inspect them.
  const { randomUUID } = await import('node:crypto');
  const fulfillmentIds: string[] = [];
  const queries = [];

  for (const f of fulfillments) {
    const fId = randomUUID();
    fulfillmentIds.push(fId);
    const label = typeof f.label === 'string' ? f.label : '';
    queries.push(sql`
      INSERT INTO public.orders_fulfillments (id, client_id, sale_id, label)
      VALUES (${fId}::uuid, ${a.ctx.clientId}::uuid, ${saleId}::uuid, ${label})
    `);
    for (const l of f.lines as Array<{ sale_line_id: string; qty: number }>) {
      queries.push(sql`
        INSERT INTO public.orders_fulfillment_lines (fulfillment_id, sale_line_id, qty)
        VALUES (${fId}::uuid, ${l.sale_line_id}::uuid, ${l.qty}::int)
      `);
    }
  }

  await sql.transaction(queries);

  await logAudit(sql, {
    session: ordersAuditSession(a.ctx),
    op: 'orders.split',
    clientId: a.ctx.clientId,
    targetType: 'sale',
    targetId: saleId,
    detail: { fulfillment_count: fulfillmentIds.length },
  });

  return jsonOk({ fulfillment_ids: fulfillmentIds }, { status: 201 });
}

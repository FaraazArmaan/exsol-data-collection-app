// GET|PUT /api/orders/shipment-detail/:id — fetch or update a single shipment.
//
// GET (perm view): return one shipment by id, scoped by client.
// PUT (perm edit): update carrier, tracking_ref, and/or status. When
//   status changes to 'shipped' the shipped_at timestamp is set if not
//   already set; 'delivered' sets delivered_at.
//
// Cross-tenant ids and unknown ids both surface as 404 (existence not leaked).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

const VALID_STATUSES = new Set(['pending', 'shipped', 'in_transit', 'delivered', 'returned']);

// Minimal forward FSM: terminal states and legal progressions.
// delivered→returned is legal; returned is the true terminal (no exits).
const FSM: Readonly<Record<string, readonly string[]>> = {
  pending:    ['shipped'],
  shipped:    ['in_transit', 'delivered', 'returned'],
  in_transit: ['delivered', 'returned'],
  delivered:  ['returned'],
  returned:   [],
};

export const config = { path: '/api/orders/shipment-detail/:id', method: ['GET', 'PUT'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string {
  return new URL(req.url).pathname.split('/').pop() ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  if (req.method === 'GET') {
    const a = await requireOrders(req, ['orders.business.view']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;
    const sql = db();

    const rows = (await sql`
      SELECT id, sale_id, client_id, carrier, tracking_ref, status,
             shipped_at, delivered_at, created_at, updated_at
      FROM public.orders_shipments
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      LIMIT 1
    `) as Array<Record<string, unknown>>;

    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(rows[0]);
  }

  if (req.method === 'PUT') {
    const a = await requireOrders(req, ['orders.business.edit']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;
    const sql = db();

    let body: { carrier?: unknown; tracking_ref?: unknown; status?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_body');
    }

    const { carrier, tracking_ref, status } = body;

    // Build the UPDATE — only touch columns that were provided
    const carrierVal = carrier !== undefined ? (typeof carrier === 'string' ? carrier : null) : undefined;
    const trackingVal = tracking_ref !== undefined ? (typeof tracking_ref === 'string' ? tracking_ref : null) : undefined;
    const statusVal = typeof status === 'string' ? status : undefined;

    // Validate status against the known enum before hitting Postgres (avoids 22P02 → 500).
    if (statusVal !== undefined && !VALID_STATUSES.has(statusVal)) {
      return jsonError(400, 'invalid_status');
    }

    // Enforce FSM when status is changing: load current status and check transition.
    if (statusVal !== undefined) {
      const current = (await sql`
        SELECT status FROM public.orders_shipments
        WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
        LIMIT 1
      `) as Array<{ status: string }>;
      if (!current[0]) return jsonError(404, 'not_found');
      const allowed = FSM[current[0].status] ?? [];
      if (!allowed.includes(statusVal)) {
        return jsonError(400, 'illegal_shipment_transition');
      }
    }

    // shipped_at / delivered_at stamps
    const setShippedAt = statusVal === 'shipped';
    const setDeliveredAt = statusVal === 'delivered';

    const rows = (await sql`
      UPDATE public.orders_shipments
      SET
        carrier      = CASE WHEN ${carrierVal !== undefined} THEN ${carrierVal ?? null} ELSE carrier END,
        tracking_ref = CASE WHEN ${trackingVal !== undefined} THEN ${trackingVal ?? null} ELSE tracking_ref END,
        status       = CASE WHEN ${statusVal !== undefined} THEN ${statusVal ?? null}::shipment_status ELSE status END,
        shipped_at   = CASE WHEN ${setShippedAt} AND shipped_at IS NULL THEN now() ELSE shipped_at END,
        delivered_at = CASE WHEN ${setDeliveredAt} THEN now() ELSE delivered_at END,
        updated_at   = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
      RETURNING id, sale_id, carrier, tracking_ref, status,
                shipped_at, delivered_at, created_at, updated_at
    `) as Array<Record<string, unknown>>;

    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(rows[0]);
  }

  return new Response('Method Not Allowed', { status: 405 });
}

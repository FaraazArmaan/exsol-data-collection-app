// GET /api/pos/sales/:id — single-sale detail with lines + audit trail.
//
// Behavior:
//   - Requires pos.history.view.
//   - Without pos.history.viewAll, the caller can only fetch sales they
//     created themselves. Cross-user reads return 404 (not 403) by design
//     — hiding even the existence of the sale (spec §6.4 leak prevention).
//   - Cross-client reads also return 404 for the same reason.
//   - Lines are returned ordered by `position`.
//   - Audit trail is filtered to rows where target_type='sale' AND
//     target_id=<saleId-text>, ordered chronologically.
//
// Routing: config.path = '/api/pos/sales/:id' coexists with sales-list.ts's
// '/api/pos/sales' — Netlify routes by full path + method, and the file-name
// pattern follows existing detail-vs-list pairs (e.g. u-products-detail.ts /
// u-products.ts).
//
// The UUID guard up front avoids leaking SQL errors on malformed ids (Postgres
// would throw 22P02 on `${id}::uuid` cast); we collapse to 404 to keep the
// "doesn't exist" surface consistent.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';

export const config = { path: '/api/pos/sales/:id' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.history.view']);
  if (!a.ok) return a.res;

  const id = new URL(req.url).pathname.split('/').pop() ?? '';
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  const sql = db();
  const sales = (await sql`
    SELECT * FROM public.sales
    WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
  `) as any[];
  const sale = sales[0];
  if (!sale) return jsonError(404, 'not_found');

  // Leak prevention — without viewAll, a caller can only see their own sales.
  // Respond 404 (not 403) so the existence of the row isn't disclosed.
  // Storefront sales are exempt: no cashier "owns" a guest order, so any
  // pos.history.view holder may read it (spec §5.5).
  if (
    !a.ctx.perms.has('pos.history.viewAll') &&
    sale.source !== 'storefront' &&
    sale.created_by_user_node !== a.ctx.userNodeId
  ) {
    return jsonError(404, 'not_found');
  }

  const lines = (await sql`
    SELECT * FROM public.sale_lines
    WHERE sale_id = ${id}::uuid
    ORDER BY position
  `) as any[];

  // audit_log.target_id is text; sale-create writes the sale UUID as a string
  // via logAudit({ targetId: saleId }), so plain text equality matches.
  // Timestamp column is `occurred_at` (per migration 025), not `created_at`.
  const audit = (await sql`
    SELECT op, actor_user_node, actor_admin, detail, occurred_at
    FROM public.audit_log
    WHERE target_type = 'sale' AND target_id = ${id}
    ORDER BY occurred_at
  `) as any[];

  return jsonOk({ ...sale, lines, audit });
}

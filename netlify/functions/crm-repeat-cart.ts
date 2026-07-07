// GET /api/crm/repeat-cart/:id — build a one-click "repeat order" from a
// customer's purchase history. Reads their paid sale_lines (linked by
// normalized-phone last-10 / lowercased email), aggregates per product, and
// returns a suggested cart (avg qty per past order) with each product's CURRENT
// price + availability so staff can re-cart into POS or hand the customer a
// storefront link. Read-only; money BIGINT → Number().
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';

export const config = { path: '/api/crm/repeat-cart/:id', method: 'GET' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idFrom = (req: Request) => new URL(req.url).pathname.split('/').pop() ?? '';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');
  const { clientId } = a.ctx;
  const sql = db();

  const custRows = (await sql`
    SELECT display_name, phone, email FROM public.crm_customers
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid LIMIT 1
  `) as Array<{ display_name: string; phone: string | null; email: string | null }>;
  const customer = custRows[0];
  if (!customer) return jsonError(404, 'not_found');

  const phoneDigits = customer.phone ? String(customer.phone).replace(/\D/g, '').slice(-10) : null;
  const email = customer.email;

  const rows = (await sql`
    SELECT sl.product_id,
           p.name AS name,
           COALESCE(p.sale_price_cents, p.price_cents)::bigint AS unit_price_cents,
           (p.status = 'active' AND p.deleted_at IS NULL AND p.pos_visible = true) AS available,
           SUM(sl.qty)::int AS total_qty,
           COUNT(DISTINCT sl.sale_id)::int AS times_bought
    FROM public.sale_lines sl
    JOIN public.sales s ON s.id = sl.sale_id
    JOIN public.products p ON p.id = sl.product_id
    WHERE s.bucket_id = ${clientId}::uuid AND s.status IN ('paid','fulfilled')
      AND ((${phoneDigits}::text IS NOT NULL AND right(regexp_replace(coalesce(s.customer_phone,''), '[^0-9]', '', 'g'), 10) = ${phoneDigits})
           OR (${email}::text IS NOT NULL AND lower(s.customer_email) = ${email}))
    GROUP BY sl.product_id, p.name, p.sale_price_cents, p.price_cents, p.status, p.deleted_at, p.pos_visible
    ORDER BY total_qty DESC
  `) as Array<{ product_id: string; name: string; unit_price_cents: string; available: boolean; total_qty: number; times_bought: number }>;

  const items = rows.map((r) => ({
    product_id: r.product_id,
    name: r.name,
    unit_price_cents: Number(r.unit_price_cents),
    // Suggested qty = average qty per past order (rounded, min 1).
    qty: Math.max(1, Math.round(r.total_qty / Math.max(1, r.times_bought))),
    available: r.available,
    times_bought: r.times_bought,
  }));

  return jsonOk({ customer_name: customer.display_name, items });
}

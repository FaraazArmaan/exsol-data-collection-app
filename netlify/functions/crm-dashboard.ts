// GET /api/crm/dashboard — customer analytics: LTV, purchase frequency, top
// customers. Read-only over crm_customers + the sales/bookings they transacted.
// crm_customers has no FK to sales/bookings — link by normalized-phone last-10
// digits (crm phone is canonical +91…, sales/bookings store raw input) or by
// lowercased email. Money is BIGINT (string from Neon) → Number().
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';

export const config = { path: '/api/crm/dashboard', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const { clientId } = a.ctx;
  const sql = db();

  // Per-customer LTV (paid sales + confirmed/completed bookings) and txn count.
  const rows = (await sql`
    WITH cust AS (
      SELECT id, display_name, first_seen,
             right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) AS pd,
             email
      FROM public.crm_customers
      WHERE client_id = ${clientId}::uuid
    ),
    sale_agg AS (
      SELECT c.id AS cid, COUNT(s.id)::int AS n,
             COALESCE(SUM(s.total_cents), 0)::bigint AS rev,
             MAX(s.created_at) AS last_at
      FROM cust c
      LEFT JOIN public.sales s
        ON s.bucket_id = ${clientId}::uuid AND s.status IN ('paid','fulfilled')
        AND ((c.pd <> '' AND right(regexp_replace(coalesce(s.customer_phone,''), '[^0-9]', '', 'g'), 10) = c.pd)
             OR (c.email IS NOT NULL AND lower(s.customer_email) = c.email))
      GROUP BY c.id
    ),
    booking_agg AS (
      SELECT c.id AS cid, COUNT(b.id)::int AS n,
             COALESCE(SUM(b.price_cents), 0)::bigint AS rev,
             MAX(b.created_at) AS last_at
      FROM cust c
      LEFT JOIN public.bookings b
        ON b.bucket_id = ${clientId}::uuid AND b.status IN ('confirmed','completed')
        AND ((c.pd <> '' AND right(regexp_replace(coalesce(b.customer_phone,''), '[^0-9]', '', 'g'), 10) = c.pd)
             OR (c.email IS NOT NULL AND lower(b.customer_email) = c.email))
      GROUP BY c.id
    )
    SELECT c.id, c.display_name,
           to_char(c.first_seen, 'YYYY-MM-DD') AS first_seen_day,
           c.first_seen,
           (COALESCE(sa.n, 0) + COALESCE(ba.n, 0))::int AS txns,
           (COALESCE(sa.rev, 0) + COALESCE(ba.rev, 0))::bigint AS ltv_cents,
           to_char(
             NULLIF(GREATEST(COALESCE(sa.last_at, 'epoch'::timestamptz), COALESCE(ba.last_at, 'epoch'::timestamptz)), 'epoch'::timestamptz),
             'YYYY-MM-DD"T"HH24:MI:SSOF'
           ) AS last_activity
    FROM cust c
    LEFT JOIN sale_agg sa ON sa.cid = c.id
    LEFT JOIN booking_agg ba ON ba.cid = c.id
    ORDER BY ltv_cents DESC
  `) as Array<{
    id: string; display_name: string; first_seen: string; txns: number;
    ltv_cents: string; last_activity: string;
  }>;

  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  let totalLtv = 0;
  let totalTxns = 0;
  let active = 0;
  let repeat = 0;
  let newLast30 = 0;
  for (const r of rows) {
    const ltv = Number(r.ltv_cents);
    totalLtv += ltv;
    totalTxns += r.txns;
    if (r.txns >= 1) active += 1;
    if (r.txns >= 2) repeat += 1;
    if (r.first_seen && now - new Date(r.first_seen).getTime() <= THIRTY_DAYS) newLast30 += 1;
  }

  const total = rows.length;
  const top_customers = rows.slice(0, 10).map((r) => ({
    id: r.id,
    display_name: r.display_name,
    ltv_cents: Number(r.ltv_cents),
    txns: r.txns,
    last_activity: r.last_activity ?? null, // NULLIF made this null when there's no activity
  }));

  return jsonOk({
    kpis: {
      total_customers: total,
      active_customers: active,
      total_ltv_cents: totalLtv,
      avg_ltv_cents: active > 0 ? Math.round(totalLtv / active) : 0,
      avg_txns: active > 0 ? Math.round((totalTxns / active) * 10) / 10 : 0,
      repeat_rate: active > 0 ? Math.round((repeat / active) * 100) : 0,
      new_last_30d: newLast30,
    },
    top_customers,
  });
}

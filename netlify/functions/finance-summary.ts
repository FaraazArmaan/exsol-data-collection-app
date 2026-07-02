// GET /api/finance/summary?month=YYYY-MM — the Finance P&L for one calendar month.
//
// Revenue is READ-ONLY over existing stores (no parallel revenue table):
//   • pos + storefront  ← public.sales, status IN ('paid','fulfilled'), split by
//                          sales.source. (sales.channel is a different axis:
//                          instore/online/pickup — not what we bucket on here.)
//   • booking           ← public.bookings, status IN ('confirmed','completed'),
//                          summed on price_cents. Bookings never touch `sales`.
// Expenses come from finance_expenses (this module's only writable table).
// Everything is filtered to the month: sales/bookings by created_at, expenses
// by incurred_on. Amounts are integer cents throughout.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { MonthQuery } from './_finance-validators';

export const config = { path: '/api/finance/summary', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireFinance(req, ['finance.business.view']);
  if (!a.ok) return a.res;
  const { clientId } = a.ctx;

  let q: MonthQuery;
  try {
    q = MonthQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const monthStart = `${q.month}-01`; // 'YYYY-MM-01' — start of the window

  // Revenue by source from paid sales (pos / storefront).
  const salesRows = (await sql`
    SELECT source AS key,
           COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')), 0)::bigint AS value
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
      AND created_at >= ${monthStart}::date
      AND created_at <  (${monthStart}::date + interval '1 month')
    GROUP BY source
  `) as Array<{ key: string; value: string }>;

  // Booking revenue — recognised for confirmed + completed bookings.
  const bookingRows = (await sql`
    SELECT COALESCE(SUM(price_cents) FILTER (WHERE status IN ('confirmed','completed')), 0)::bigint AS value
    FROM public.bookings
    WHERE bucket_id = ${clientId}::uuid
      AND created_at >= ${monthStart}::date
      AND created_at <  (${monthStart}::date + interval '1 month')
  `) as Array<{ value: string }>;

  const expenseRows = (await sql`
    SELECT COALESCE(SUM(amount_cents), 0)::bigint AS value
    FROM public.finance_expenses
    WHERE client_id = ${clientId}::uuid
      AND incurred_on >= ${monthStart}::date
      AND incurred_on <  (${monthStart}::date + interval '1 month')
  `) as Array<{ value: string }>;

  const bySource = new Map(salesRows.map((r) => [r.key, Number(r.value)]));
  const pos = bySource.get('pos') ?? 0;
  const storefront = bySource.get('storefront') ?? 0;
  const booking = Number(bookingRows[0]?.value ?? 0);

  const revenue_cents = pos + storefront + booking;
  const expenses_cents = Number(expenseRows[0]?.value ?? 0);
  const net_cents = revenue_cents - expenses_cents;

  return jsonOk({
    month: q.month,
    revenue_cents,
    expenses_cents,
    net_cents,
    revenue_by_channel: { pos, storefront, booking },
  });
}

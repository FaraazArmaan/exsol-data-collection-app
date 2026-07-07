// GET /api/finance/cashflow?month=YYYY-MM — daily income vs expense for one month.
//
// Income (read-only, same sources as the P&L):
//   • sales    — status IN ('paid','fulfilled'), total_cents, by created_at
//   • bookings — status IN ('confirmed','completed'), price_cents, by created_at
// Income days are bucketed in the CLIENT's timezone (clients.timezone, default
// Asia/Kolkata) so a late-evening sale lands on the local calendar day — matching
// analytics-sales. Expenses come from finance_expenses.incurred_on (already a
// tz-naive DATE). Returns SPARSE days (only those with activity); the frontend
// fills the month grid. Amounts are integer cents.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { MonthQuery } from './_finance-validators';

export const config = { path: '/api/finance/cashflow', method: 'GET' };

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
  const monthStart = `${q.month}-01`;

  const clientRows = (await sql`
    SELECT timezone, base_currency FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ timezone: string; base_currency: string }>;
  const tz = clientRows[0]?.timezone ?? 'UTC';
  const base_currency = clientRows[0]?.base_currency ?? 'INR';

  // Income per local day, unioning sales + bookings.
  const incomeRows = (await sql`
    SELECT d AS date, SUM(cents)::bigint AS cents
    FROM (
      SELECT to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, total_cents AS cents
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND status IN ('paid','fulfilled')
        AND created_at >= ${monthStart}::date
        AND created_at <  (${monthStart}::date + interval '1 month')
      UNION ALL
      SELECT to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, price_cents AS cents
      FROM public.bookings
      WHERE bucket_id = ${clientId}::uuid
        AND status IN ('confirmed','completed')
        AND created_at >= ${monthStart}::date
        AND created_at <  (${monthStart}::date + interval '1 month')
    ) rows
    GROUP BY d
  `) as Array<{ date: string; cents: string }>;

  const expenseRows = (await sql`
    SELECT to_char(incurred_on, 'YYYY-MM-DD') AS date, SUM(amount_base_cents)::bigint AS cents
    FROM public.finance_expenses
    WHERE client_id = ${clientId}::uuid
      AND (approval_status IS NULL OR approval_status = 'approved')
      AND incurred_on >= ${monthStart}::date
      AND incurred_on <  (${monthStart}::date + interval '1 month')
    GROUP BY 1
  `) as Array<{ date: string; cents: string }>;

  // Merge into one map keyed by date.
  const byDay = new Map<string, { income_cents: number; expense_cents: number }>();
  for (const r of incomeRows) {
    const day = byDay.get(r.date) ?? { income_cents: 0, expense_cents: 0 };
    day.income_cents += Number(r.cents);
    byDay.set(r.date, day);
  }
  for (const r of expenseRows) {
    const day = byDay.get(r.date) ?? { income_cents: 0, expense_cents: 0 };
    day.expense_cents += Number(r.cents);
    byDay.set(r.date, day);
  }

  const days = Array.from(byDay.entries())
    .map(([date, v]) => ({
      date,
      income_cents: v.income_cents,
      expense_cents: v.expense_cents,
      net_cents: v.income_cents - v.expense_cents,
    }))
    .sort((x, y) => x.date.localeCompare(y.date));

  const totals = days.reduce(
    (acc, d) => ({
      income_cents: acc.income_cents + d.income_cents,
      expense_cents: acc.expense_cents + d.expense_cents,
      net_cents: acc.net_cents + d.net_cents,
    }),
    { income_cents: 0, expense_cents: 0, net_cents: 0 },
  );

  return jsonOk({ month: q.month, base_currency, days, totals });
}

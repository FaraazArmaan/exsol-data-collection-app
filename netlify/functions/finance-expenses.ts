// GET/POST /api/finance/expenses — the expenses ledger, always scoped to a month.
//   GET  ?month=YYYY-MM → list expenses incurred that month (newest first).
//   POST                → create one expense (finance.business.create).
// Detail edits/deletes live in finance-expense-detail.ts (distinct path to avoid
// list-vs-:id ambiguity).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { ExpenseCreate, MonthQuery } from './_finance-validators';

export const config = { path: '/api/finance/expenses', method: ['GET', 'POST'] };

// neon returns BIGINT (amount_cents) as a string to avoid precision loss; coerce
// to a JS number so the wire shape matches the declared Expense type. Safe: cents
// values are far below Number.MAX_SAFE_INTEGER.
function shapeExpense(row: any) {
  return { ...row, amount_cents: Number(row.amount_cents) };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireFinance(req, ['finance.business.view']);
    if (!a.ok) return a.res;

    let q: MonthQuery;
    try {
      q = MonthQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
    } catch (e: any) {
      return jsonError(400, 'invalid_query', { issues: e?.issues });
    }

    const sql = db();
    const monthStart = `${q.month}-01`;
    const rows = (await sql`
      SELECT id, client_id, category, amount_cents, note,
             to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on, created_by, created_at
      FROM public.finance_expenses
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND incurred_on >= ${monthStart}::date
        AND incurred_on <  (${monthStart}::date + interval '1 month')
      ORDER BY incurred_on DESC, created_at DESC
    `) as any[];
    return jsonOk({ expenses: rows.map(shapeExpense) });
  }

  if (req.method === 'POST') {
    const a = await requireFinance(req, ['finance.business.create']);
    if (!a.ok) return a.res;

    let body: ExpenseCreate;
    try {
      body = ExpenseCreate.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }

    const sql = db();
    const rows = (await sql`
      INSERT INTO public.finance_expenses
        (client_id, category, amount_cents, note, incurred_on, created_by)
      VALUES
        (${a.ctx.clientId}::uuid, ${body.category}, ${body.amount_cents},
         ${body.note ?? null}, ${body.incurred_on}::date, ${a.ctx.userNodeId}::uuid)
      RETURNING id, client_id, category, amount_cents, note,
                to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on, created_by, created_at
    `) as any[];
    return jsonOk(shapeExpense(rows[0]), { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}

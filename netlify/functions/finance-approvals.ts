// GET /api/finance/approvals?status=pending|decided — the approval queue.
//   pending → expenses awaiting sign-off (oldest first, FIFO).
//   decided → recently approved/rejected (newest first, capped).
// Not month-scoped — a pending expense should surface until it's resolved.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { ApprovalQuery } from './_finance-validators';
import { fetchBaseCurrency } from './_finance-fx';

export const config = { path: '/api/finance/approvals', method: 'GET' };

function shape(row: any) {
  return {
    ...row,
    amount_cents: Number(row.amount_cents),
    amount_base_cents: Number(row.amount_base_cents),
    fx_rate: Number(row.fx_rate),
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireFinance(req, ['finance.business.view']);
  if (!a.ok) return a.res;

  let q: ApprovalQuery;
  try {
    q = ApprovalQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const rows = q.status === 'pending'
    ? (await sql`
        SELECT id, client_id, category, amount_cents, currency, amount_base_cents, fx_rate,
               note, to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on, created_by, created_at,
               approval_status, approved_by, approved_at, approval_note
        FROM public.finance_expenses
        WHERE client_id = ${a.ctx.clientId}::uuid AND approval_status = 'pending'
        ORDER BY created_at ASC
      `) as any[]
    : (await sql`
        SELECT id, client_id, category, amount_cents, currency, amount_base_cents, fx_rate,
               note, to_char(incurred_on, 'YYYY-MM-DD') AS incurred_on, created_by, created_at,
               approval_status, approved_by, approved_at, approval_note
        FROM public.finance_expenses
        WHERE client_id = ${a.ctx.clientId}::uuid AND approval_status IN ('approved', 'rejected')
        ORDER BY approved_at DESC NULLS LAST
        LIMIT 50
      `) as any[];

  const base_currency = await fetchBaseCurrency(sql, a.ctx.clientId);
  return jsonOk({ approvals: rows.map(shape), base_currency });
}

// PATCH/DELETE /api/finance/recurring-detail/:id — edit (incl. pause via active),
// or delete a template. Client-scoped so cross-tenant ids read as 404. Distinct
// path segment keeps it clear of the list route /api/finance/recurring.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireFinance } from './_finance-authz';
import { RecurringPatch } from './_finance-validators';
import { fetchBaseCurrency, resolveCurrency } from './_finance-fx';
import { shapeTemplate } from './finance-recurring';

export const config = { path: '/api/finance/recurring-detail/:id', method: ['PATCH', 'DELETE'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  if (req.method === 'PATCH') {
    const a = await requireFinance(req, ['finance.business.edit']);
    if (!a.ok) return a.res;

    let patch: RecurringPatch;
    try {
      patch = RecurringPatch.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }

    const sql = db();
    const existing = (await sql`
      SELECT amount_cents, currency, fx_rate
      FROM public.finance_recurring_templates
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      LIMIT 1
    `) as Array<{ amount_cents: string; currency: string; fx_rate: string }>;
    if (!existing[0]) return jsonError(404, 'not_found');

    // Validate the merged currency/rate (a foreign currency still needs a rate).
    const amountCents = patch.amount_cents ?? Number(existing[0].amount_cents);
    const currency = patch.currency ?? existing[0].currency;
    const fxRate = patch.fx_rate ?? Number(existing[0].fx_rate);
    const base = await fetchBaseCurrency(sql, a.ctx.clientId);
    const cur = resolveCurrency(amountCents, base, currency, fxRate);
    if ('error' in cur) return jsonError(400, cur.error);

    const rows = (await sql`
      UPDATE public.finance_recurring_templates SET
        category    = COALESCE(${patch.category ?? null}, category),
        amount_cents = ${amountCents},
        currency    = ${cur.currency},
        fx_rate     = ${cur.fx_rate},
        note        = CASE WHEN ${patch.note !== undefined} THEN ${patch.note ?? null} ELSE note END,
        cadence     = COALESCE(${patch.cadence ?? null}, cadence),
        next_run    = COALESCE(${patch.next_run ?? null}::date, next_run),
        active      = COALESCE(${patch.active ?? null}, active),
        updated_at  = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, client_id, category, amount_cents, currency, fx_rate, note, cadence,
                to_char(next_run, 'YYYY-MM-DD') AS next_run, active,
                to_char(last_materialized_on, 'YYYY-MM-DD') AS last_materialized_on,
                created_by, created_at
    `) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(shapeTemplate(rows[0]));
  }

  // DELETE — materialized expenses keep their history (template_id → NULL via FK).
  const a = await requireFinance(req, ['finance.business.delete']);
  if (!a.ok) return a.res;
  const sql = db();
  const rows = (await sql`
    DELETE FROM public.finance_recurring_templates
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return jsonOk({ id: rows[0].id, deleted: true });
}

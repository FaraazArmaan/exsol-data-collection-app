// Shared recurring-expense materialization — used by the scheduled cron AND the
// on-demand "run now" endpoint (and called directly from tests). Materializes at
// most ONE occurrence per due template per invocation: a milestone ('once')
// fires and deactivates; 'weekly'/'monthly' fire and advance next_run. A template
// far behind catches up one period per subsequent run (the cron runs daily).
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { computeBaseCents } from './_finance-fx';

type SQL = NeonQueryFunction<false, false>;

/** Advance a 'YYYY-MM-DD' by cadence. 'once' → null (template should deactivate). */
export function advanceNextRun(dateISO: string, cadence: string): string | null {
  if (cadence === 'once') return null;
  const [ys, ms, ds] = dateISO.split('-');
  const dt = new Date(Date.UTC(Number(ys), Number(ms) - 1, Number(ds)));
  if (cadence === 'weekly') dt.setUTCDate(dt.getUTCDate() + 7);
  else dt.setUTCMonth(dt.getUTCMonth() + 1);
  return dt.toISOString().slice(0, 10);
}

interface DueTemplate {
  id: string;
  client_id: string;
  category: string;
  amount_cents: string;
  currency: string;
  fx_rate: string;
  note: string | null;
  cadence: string;
  next_run: string;
  created_by: string | null;
  base_currency: string;
}

/**
 * Materialize every due template (next_run <= asOf) into a finance_expense,
 * optionally scoped to one client. Returns the number of expenses created.
 * asOf defaults to today (UTC calendar date).
 */
export async function materializeDueTemplates(
  sql: SQL,
  opts: { clientId?: string; asOf?: string } = {},
): Promise<number> {
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const clientId = opts.clientId ?? null;

  const templates = (await sql`
    SELECT t.id, t.client_id, t.category, t.amount_cents, t.currency, t.fx_rate,
           t.note, t.cadence, to_char(t.next_run, 'YYYY-MM-DD') AS next_run,
           t.created_by, c.base_currency
    FROM public.finance_recurring_templates t
    JOIN public.clients c ON c.id = t.client_id
    WHERE t.active = true
      AND t.next_run <= ${asOf}::date
      AND (${clientId}::uuid IS NULL OR t.client_id = ${clientId}::uuid)
  `) as DueTemplate[];

  let count = 0;
  for (const t of templates) {
    const amountCents = Number(t.amount_cents);
    const fxRate = Number(t.fx_rate);
    const baseCents = computeBaseCents(amountCents, t.currency, t.base_currency, fxRate);

    await sql`
      INSERT INTO public.finance_expenses
        (client_id, category, amount_cents, currency, amount_base_cents, fx_rate,
         note, incurred_on, created_by, template_id)
      VALUES
        (${t.client_id}::uuid, ${t.category}, ${amountCents}, ${t.currency},
         ${baseCents}, ${fxRate}, ${t.note}, ${t.next_run}::date, ${t.created_by}, ${t.id}::uuid)
    `;

    const next = advanceNextRun(t.next_run, t.cadence);
    if (next === null) {
      await sql`
        UPDATE public.finance_recurring_templates
           SET active = false, last_materialized_on = ${t.next_run}::date, updated_at = now()
         WHERE id = ${t.id}::uuid
      `;
    } else {
      await sql`
        UPDATE public.finance_recurring_templates
           SET next_run = ${next}::date, last_materialized_on = ${t.next_run}::date, updated_at = now()
         WHERE id = ${t.id}::uuid
      `;
    }
    count++;
  }
  return count;
}

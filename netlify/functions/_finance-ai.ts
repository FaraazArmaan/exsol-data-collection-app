// AI finance insights — gathers monthly P&L facts and turns them into a narrative
// + anomalies + health score. Uses the shared ai.ts seam; when it returns the
// dev fallback (no ANTHROPIC_API_KEY) or unparseable output, a deterministic
// rule-based summary is produced instead so the dashboard is always useful.
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { ask } from './_shared/ai';
import { formatMoney } from '../../src/lib/currency';

type SQL = NeonQueryFunction<false, false>;

export type Severity = 'info' | 'warn' | 'high';
export interface Anomaly { title: string; severity: Severity; detail: string; }

export interface PublicFacts {
  revenue_cents: number;
  expenses_cents: number;
  net_cents: number;
  prev_net_cents: number;
  revenue_by_channel: { pos: number; storefront: number; booking: number };
  expenses_by_category: Array<{ category: string; cents: number }>;
}

export interface InsightPayload {
  narrative: string;
  anomalies: Anomaly[];
  health_score: number;
  facts: PublicFacts;
}

interface Facts extends PublicFacts {
  prev_revenue_cents: number;
}

function priorMonth(month: string): string {
  const [ys, ms] = month.split('-');
  const d = new Date(Number(ys), Number(ms) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(month: string): string {
  const [ys, ms] = month.split('-');
  return new Date(Number(ys), Number(ms) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function revenueFor(sql: SQL, clientId: string, monthStart: string) {
  const salesRows = (await sql`
    SELECT source AS key,
           COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')), 0)::bigint AS value
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
      AND created_at >= ${monthStart}::date AND created_at < (${monthStart}::date + interval '1 month')
    GROUP BY source
  `) as Array<{ key: string; value: string }>;
  const bookingRow = (await sql`
    SELECT COALESCE(SUM(price_cents) FILTER (WHERE status IN ('confirmed','completed')), 0)::bigint AS value
    FROM public.bookings
    WHERE bucket_id = ${clientId}::uuid
      AND created_at >= ${monthStart}::date AND created_at < (${monthStart}::date + interval '1 month')
  `) as Array<{ value: string }>;
  const bySource = new Map(salesRows.map((r) => [r.key, Number(r.value)]));
  const pos = bySource.get('pos') ?? 0;
  const storefront = bySource.get('storefront') ?? 0;
  const booking = Number(bookingRow[0]?.value ?? 0);
  return { pos, storefront, booking, total: pos + storefront + booking };
}

async function expensesFor(sql: SQL, clientId: string, monthStart: string): Promise<number> {
  const rows = (await sql`
    SELECT COALESCE(SUM(amount_base_cents), 0)::bigint AS value
    FROM public.finance_expenses
    WHERE client_id = ${clientId}::uuid
      AND (approval_status IS NULL OR approval_status = 'approved')
      AND incurred_on >= ${monthStart}::date AND incurred_on < (${monthStart}::date + interval '1 month')
  `) as Array<{ value: string }>;
  return Number(rows[0]?.value ?? 0);
}

async function gatherFacts(sql: SQL, clientId: string, month: string): Promise<Facts> {
  const monthStart = `${month}-01`;
  const prevStart = `${priorMonth(month)}-01`;

  const rev = await revenueFor(sql, clientId, monthStart);
  const exp = await expensesFor(sql, clientId, monthStart);
  const prevRev = await revenueFor(sql, clientId, prevStart);
  const prevExp = await expensesFor(sql, clientId, prevStart);

  const catRows = (await sql`
    SELECT category, COALESCE(SUM(amount_base_cents), 0)::bigint AS cents
    FROM public.finance_expenses
    WHERE client_id = ${clientId}::uuid
      AND (approval_status IS NULL OR approval_status = 'approved')
      AND incurred_on >= ${monthStart}::date AND incurred_on < (${monthStart}::date + interval '1 month')
    GROUP BY category ORDER BY cents DESC
  `) as Array<{ category: string; cents: string }>;

  return {
    revenue_cents: rev.total,
    expenses_cents: exp,
    net_cents: rev.total - exp,
    prev_revenue_cents: prevRev.total,
    prev_net_cents: prevRev.total - prevExp,
    revenue_by_channel: { pos: rev.pos, storefront: rev.storefront, booking: rev.booking },
    expenses_by_category: catRows.map((r) => ({ category: r.category, cents: Number(r.cents) })),
  };
}

// Deterministic rule-based insight — used when the LLM is unavailable, and a good
// baseline the model output must beat.
export function buildFallbackInsight(facts: Facts, base: string, month: string): Omit<InsightPayload, 'facts'> {
  const fmt = (c: number) => formatMoney(c, base);
  const { revenue_cents: rev, expenses_cents: exp, net_cents: net, prev_revenue_cents: prevRev } = facts;
  const anomalies: Anomaly[] = [];

  if (net < 0) {
    anomalies.push({ title: 'Operating at a loss', severity: 'high',
      detail: `Expenses (${fmt(exp)}) exceeded revenue (${fmt(rev)}), a net loss of ${fmt(-net)}.` });
  } else if (rev > 0 && pct(exp, rev) > 80) {
    anomalies.push({ title: 'Thin margin', severity: 'warn',
      detail: `Expenses are ${Math.round(pct(exp, rev))}% of revenue — little cushion.` });
  }
  if (prevRev > 0) {
    const drop = pct(prevRev - rev, prevRev);
    if (drop > 15) anomalies.push({ title: 'Revenue down vs last month', severity: 'warn',
      detail: `Revenue fell ${Math.round(drop)}% from ${fmt(prevRev)} to ${fmt(rev)}.` });
  }
  const top = facts.expenses_by_category[0];
  if (top && exp > 0 && pct(top.cents, exp) > 40) {
    anomalies.push({ title: `${cap(top.category)} dominates spend`, severity: 'info',
      detail: `${cap(top.category)} is ${Math.round(pct(top.cents, exp))}% of expenses (${fmt(top.cents)}).` });
  }
  if (anomalies.length === 0) {
    anomalies.push({ title: 'Healthy month', severity: 'info',
      detail: 'No red flags in this month’s numbers.' });
  }

  const marginPct = rev > 0 ? (net / rev) * 100 : (net >= 0 ? 0 : -100);
  const health_score = Math.max(0, Math.min(100, Math.round(50 + marginPct / 2)));

  const narrative =
    `In ${monthLabel(month)}, the business took in ${fmt(rev)} against ${fmt(exp)} in expenses, `
    + `for a net ${net >= 0 ? 'profit' : 'loss'} of ${fmt(Math.abs(net))}. `
    + (prevRev > 0
      ? `Revenue ${rev >= prevRev ? 'rose' : 'fell'} versus last month (${fmt(prevRev)}).`
      : 'This is the first month with recorded revenue.');

  return { narrative, anomalies, health_score };
}

export async function generateInsight(
  sql: SQL, clientId: string, month: string, base: string,
): Promise<{ payload: InsightPayload; model: string; is_fallback: boolean }> {
  const facts = await gatherFacts(sql, clientId, month);

  const result = await ask({
    system: 'You are a concise financial analyst for a small business. Respond with ONLY minified '
      + 'JSON of shape {"narrative":string,"anomalies":[{"title":string,"severity":"info"|"warn"|"high","detail":string}],"health_score":number}. '
      + 'No markdown, no prose outside the JSON.',
    prompt: `Base currency ${base}. Monthly P&L (amounts are integer minor units) for ${month}: `
      + `${JSON.stringify(facts)}. Give a 2-3 sentence narrative, up to 4 anomalies (most severe first), `
      + 'and a 0-100 health score.',
    maxTokens: 800,
  });

  if (!result.fallback) {
    try {
      const parsed = JSON.parse(result.text);
      if (parsed && typeof parsed.narrative === 'string' && Array.isArray(parsed.anomalies)
        && typeof parsed.health_score === 'number') {
        const anomalies: Anomaly[] = parsed.anomalies
          .filter((x: any) => x && typeof x.title === 'string')
          .slice(0, 4)
          .map((x: any) => ({
            title: String(x.title),
            severity: (['info', 'warn', 'high'].includes(x.severity) ? x.severity : 'info') as Severity,
            detail: String(x.detail ?? ''),
          }));
        return {
          payload: {
            narrative: parsed.narrative,
            anomalies,
            health_score: Math.max(0, Math.min(100, Math.round(parsed.health_score))),
            facts,
          },
          model: result.model,
          is_fallback: false,
        };
      }
    } catch { /* fall through to rule-based */ }
  }

  const fb = buildFallbackInsight(facts, base, month);
  return { payload: { ...fb, facts }, model: result.model, is_fallback: true };
}

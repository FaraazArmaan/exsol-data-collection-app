import { useEffect, useState } from 'react';
import { financeApi } from '../shared/api';
import type { CashflowDay, CashflowMonth } from '../shared/types';
import { formatMoney, monthLabel } from '../shared/format';
import { humanError } from './OverviewTab';

interface Props {
  month: string; // 'YYYY-MM'
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A calendar cell: either a real day (with optional activity) or a blank filler
// that pads the first week to the correct weekday.
interface Cell {
  day: number | null;
  date: string | null;
  flow?: CashflowDay;
}

function buildCells(month: string, byDate: Map<string, CashflowDay>): Cell[] {
  const [ys, ms] = month.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ day: null, date: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, date, flow: byDate.get(date) });
  }
  return cells;
}

export function CashflowTab({ month }: Props) {
  const [data, setData] = useState<CashflowMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    financeApi.cashflow(month)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) { setData(null); setError(humanError(e)); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month]);

  if (error) {
    return (
      <div className="fin-banner" role="alert">
        {error}
        <button className="fin-link" onClick={() => setError(null)}>dismiss</button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <section className="fin-panel">
        <div className="fin-panel-header">Cashflow calendar</div>
        <p className="fin-muted fin-pad">Loading…</p>
      </section>
    );
  }

  const fmt = (c: number) => formatMoney(c, data.base_currency);
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const cells = buildCells(month, byDate);
  const activeDays = data.days.filter((d) => d.income_cents > 0 || d.expense_cents > 0);
  const hasActivity = activeDays.length > 0;

  return (
    <>
      {/* Totals */}
      <section className="fin-cards" aria-label="Cashflow totals">
        <div className="fin-card fin-card-revenue">
          <div className="fin-card-label">Money in</div>
          <div className="fin-card-value">{fmt(data.totals.income_cents)}</div>
        </div>
        <div className="fin-card fin-card-expense">
          <div className="fin-card-label">Money out</div>
          <div className="fin-card-value">{fmt(data.totals.expense_cents)}</div>
        </div>
        <div className={`fin-card fin-card-${data.totals.net_cents < 0 ? 'negative' : 'positive'}`}>
          <div className="fin-card-label">Net flow</div>
          <div className="fin-card-value">{fmt(data.totals.net_cents)}</div>
        </div>
      </section>

      <section className="fin-panel" aria-label="Cashflow calendar">
        <div className="fin-panel-header">Cashflow — {monthLabel(month)}</div>

        {!hasActivity && (
          <p className="fin-empty">No money moved in {monthLabel(month)} yet.</p>
        )}

        {hasActivity && (
          <>
            {/* Desktop / tablet: month grid */}
            <div className="fin-cal-grid" role="grid" aria-label="Cashflow month grid">
              {WEEKDAYS.map((w, i) => (
                <div key={`h${i}`} className="fin-cal-weekday" role="columnheader">{w}</div>
              ))}
              {cells.map((c, i) => (
                <div
                  key={i}
                  className={`fin-cal-cell ${c.day === null ? 'fin-cal-cell-blank' : ''} ${
                    c.flow && c.flow.net_cents < 0 ? 'fin-cal-cell-neg' : c.flow ? 'fin-cal-cell-pos' : ''
                  }`}
                  role={c.day === null ? undefined : 'gridcell'}
                >
                  {c.day !== null && (
                    <>
                      <span className="fin-cal-daynum">{c.day}</span>
                      {c.flow && (
                        <span className="fin-cal-flows">
                          {c.flow.income_cents > 0 && (
                            <span className="fin-cal-in">▲ {fmt(c.flow.income_cents)}</span>
                          )}
                          {c.flow.expense_cents > 0 && (
                            <span className="fin-cal-out">▼ {fmt(c.flow.expense_cents)}</span>
                          )}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Mobile: day list (grid is too wide under 560px) */}
            <ul className="fin-cal-list">
              {activeDays.map((d) => (
                <li key={d.date} className="fin-cal-list-row">
                  <span className="fin-cal-list-date">{dayLabel(d.date)}</span>
                  <span className="fin-cal-list-amts">
                    {d.income_cents > 0 && <span className="fin-cal-in">▲ {fmt(d.income_cents)}</span>}
                    {d.expense_cents > 0 && <span className="fin-cal-out">▼ {fmt(d.expense_cents)}</span>}
                    <span className={d.net_cents < 0 ? 'fin-danger' : 'fin-cal-net-pos'}>
                      {fmt(d.net_cents)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

// 'YYYY-MM-DD' → 'Mon 3' (weekday + day-of-month), tz-safe.
function dayLabel(iso: string): string {
  const [ys, ms, ds] = iso.split('-');
  const dt = new Date(Number(ys), Number(ms) - 1, Number(ds));
  return dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

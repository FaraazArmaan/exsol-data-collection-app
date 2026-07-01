import type { ReactNode } from 'react';
import { KpiTile } from './KpiTile';
import { TrendChart } from './TrendChart';
import { BarChart } from './BarChart';
import { DonutChart } from './DonutChart';
import { formatValue } from '../format';
import { downloadDomainCsv } from '../exportCsv';
import type { DomainResponse, Breakdown } from '../types';

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="analytics-chart-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function BreakdownTable({ b }: { b: Breakdown }) {
  return (
    <table className="analytics-table">
      <thead>
        <tr><th>{b.label}</th><th className="num">Value</th><th className="num">%</th></tr>
      </thead>
      <tbody>
        {b.rows.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td className="num">{formatValue(r.value, b.unit)}</td>
            <td className="num">{r.pct.toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Generic domain panel — renders any endpoint's { kpis, series, breakdowns }.
// Every analytics domain reuses this; adding a domain is a new endpoint + a
// call site, not a new component.
export function DomainPanel({ title, data }: {
  title: string;
  data: DomainResponse;
}) {
  const empty =
    data.kpis.every((k) => k.value === 0) &&
    data.series.every((s) => s.points.length === 0);

  return (
    <section className="analytics-panel">
      <h2>
        {title}
        {!empty && (
          <button type="button" className="analytics-export analytics-panel-export"
                  onClick={() => downloadDomainCsv(title, data)}>Export</button>
        )}
      </h2>
      <div className="analytics-kpi-row">
        {data.kpis.map((k) => (
          <KpiTile key={k.id} label={k.label} value={k.value} unit={k.unit} deltaPct={k.deltaPct ?? null} />
        ))}
      </div>

      {empty ? (
        <div className="analytics-empty">No data in this range.</div>
      ) : (
        <>
          {data.series.map((s) => (
            <ChartCard key={s.id} title={s.label}>
              {s.chart === 'bar'
                ? <BarChart rows={s.points.map((p) => ({ key: p.x, value: p.y }))} unit={s.unit} />
                : <TrendChart points={s.points} unit={s.unit} />}
            </ChartCard>
          ))}
          {data.breakdowns.length > 0 && (
            <div className="analytics-breakdown-row">
              {data.breakdowns.map((b) => (
                <ChartCard key={b.id} title={b.label}>
                  {b.viz === 'donut' ? <DonutChart rows={b.rows} unit={b.unit} />
                    : b.viz === 'table' ? <BreakdownTable b={b} />
                    : <BarChart rows={b.rows} unit={b.unit} />}
                </ChartCard>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

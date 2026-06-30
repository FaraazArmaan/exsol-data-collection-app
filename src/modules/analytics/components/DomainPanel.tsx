import { KpiTile } from './KpiTile';
import { TrendChart } from './TrendChart';
import { BarChart } from './BarChart';
import { DonutChart } from './DonutChart';
import type { SalesResponse } from '../types';

export function SalesPanel({ data }: { data: SalesResponse }) {
  const byChannel = data.breakdowns.find((b) => b.id === 'by_channel');
  const byCategory = data.breakdowns.find((b) => b.id === 'by_category');
  const revSeries = data.series.find((s) => s.id === 'revenue_by_day');
  return (
    <section className="analytics-panel">
      <h2>Sales</h2>
      <div className="analytics-kpi-row">
        {data.kpis.map((k) => (
          <KpiTile key={k.id} label={k.label} value={k.value} unit={k.unit} deltaPct={k.deltaPct ?? null} />
        ))}
      </div>
      {revSeries && revSeries.points.length > 0 && <TrendChart points={revSeries.points} />}
      <div className="analytics-breakdown-row">
        {byChannel && byChannel.rows.length > 0 && <BarChart rows={byChannel.rows} />}
        {byCategory && byCategory.rows.length > 0 && <DonutChart rows={byCategory.rows} />}
      </div>
    </section>
  );
}

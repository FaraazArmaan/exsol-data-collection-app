import { KpiTile } from './KpiTile';
import type { OverviewResponse } from '../types';

// Top strip: one headline KPI per bucket the caller is entitled to. Deltas are
// omitted here (headline snapshot); per-domain panels carry the trend + delta.
export function OverviewScorecard({ data }: { data: OverviewResponse }) {
  if (!data.kpis.length) return null;
  return (
    <div className="analytics-scorecard">
      {data.kpis.map((k) => (
        <KpiTile key={k.id} label={k.label} value={k.value} unit={k.unit} deltaPct={null} />
      ))}
    </div>
  );
}

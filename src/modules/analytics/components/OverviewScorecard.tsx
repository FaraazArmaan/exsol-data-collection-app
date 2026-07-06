import { KpiTile } from './KpiTile';
import type { OverviewResponse } from '../shared/types';

// Top strip: one headline KPI per bucket the caller is entitled to. Windowed
// headlines (revenue/customers) carry a delta vs the comparison window;
// snapshots (team/catalog) have none.
export function OverviewScorecard({ data }: { data: OverviewResponse }) {
  if (!data.kpis.length) return null;
  return (
    <div className="analytics-scorecard">
      {data.kpis.map((k) => (
        <KpiTile key={k.id} label={k.label} value={k.value} unit={k.unit} deltaPct={k.deltaPct ?? null} />
      ))}
    </div>
  );
}

import { formatValue } from '../format';

interface Props {
  label: string;
  value: number;
  unit: 'cents' | 'count';
  deltaPct: number | null;
}

// One scorecard tile: label, formatted value, and an optional delta badge.
export function KpiTile({ label, value, unit, deltaPct }: Props) {
  const display = formatValue(value, unit);
  const dir = deltaPct == null ? null : deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
  const marker = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  return (
    <div className="analytics-kpi-tile">
      <div className="analytics-kpi-label">{label}</div>
      <div className="analytics-kpi-value">{display}</div>
      {dir != null && (
        <div className={`analytics-kpi-delta is-${dir}`}>
          {marker} {Math.abs(deltaPct!).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

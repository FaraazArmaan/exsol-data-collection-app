interface Props {
  label: string;
  value: number;
  unit: 'cents' | 'count';
  deltaPct: number | null;
}

// One scorecard tile: label, formatted value, and an optional delta badge.
// Cents render as INR currency (the platform's currency, clients.timezone /
// Razorpay context); counts render as plain integers.
export function KpiTile({ label, value, unit, deltaPct }: Props) {
  const display = unit === 'cents'
    ? new Intl.NumberFormat(undefined, {
        style: 'currency', currency: 'INR', maximumFractionDigits: 0,
      }).format(value / 100)
    : new Intl.NumberFormat().format(value);
  const up = (deltaPct ?? 0) >= 0;
  return (
    <div className="analytics-kpi-tile">
      <div className="analytics-kpi-label">{label}</div>
      <div className="analytics-kpi-value">{display}</div>
      {deltaPct != null && (
        <div className={`analytics-kpi-delta ${up ? 'is-up' : 'is-down'}`}>
          {up ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

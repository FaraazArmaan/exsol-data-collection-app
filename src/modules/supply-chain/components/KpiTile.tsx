export function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="sc-kpi">
      <div className="sc-kpi-value">{value}</div>
      <div className="sc-kpi-label">{label}</div>
    </div>
  );
}

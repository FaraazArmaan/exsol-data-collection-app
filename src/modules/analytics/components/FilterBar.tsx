import type { AnalyticsParams } from '../types';

const PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 0 },
  { label: '7d', days: 6 },
  { label: '30d', days: 29 },
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function FilterBar({ params, onChange, exportHref }: {
  params: AnalyticsParams;
  onChange: (p: AnalyticsParams) => void;
  exportHref: string;
}) {
  const setPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    onChange({ ...params, from: iso(from), to: iso(to) });
  };
  return (
    <div className="analytics-filterbar">
      {PRESETS.map((p) => (
        <button key={p.label} type="button" onClick={() => setPreset(p.days)}>{p.label}</button>
      ))}
      <select
        aria-label="Comparison"
        value={params.compare ?? 'none'}
        onChange={(e) => onChange({ ...params, compare: e.target.value })}
      >
        <option value="none">No comparison</option>
        <option value="prior_period">vs prior period</option>
        <option value="prior_year">vs prior year</option>
      </select>
      <a className="analytics-export" href={exportHref}>Export</a>
    </div>
  );
}

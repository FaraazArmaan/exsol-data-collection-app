import type { AnalyticsParams } from '../types';
import { todayISO, daysAgoISO } from '../format';

const PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 0 },
  { label: '7d', days: 6 },
  { label: '30d', days: 29 },
  { label: '90d', days: 89 },
];

export function FilterBar({ params, onChange }: {
  params: AnalyticsParams;
  onChange: (p: AnalyticsParams) => void;
}) {
  const today = todayISO();
  const activePreset = params.to === today
    ? PRESETS.find((p) => params.from === daysAgoISO(p.days))?.label ?? null
    : null;

  const setPreset = (days: number) =>
    onChange({ ...params, from: daysAgoISO(days), to: today });

  return (
    <div className="analytics-filterbar">
      <div className="analytics-segmented" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p.label} type="button"
                  aria-pressed={activePreset === p.label}
                  onClick={() => setPreset(p.days)}>{p.label}</button>
        ))}
      </div>

      <label>From
        <input type="date" value={params.from} max={params.to}
               onChange={(e) => onChange({ ...params, from: e.target.value })} />
      </label>
      <label>To
        <input type="date" value={params.to} min={params.from} max={today}
               onChange={(e) => onChange({ ...params, to: e.target.value })} />
      </label>

      <select aria-label="Granularity" value={params.granularity ?? 'day'}
              onChange={(e) => onChange({ ...params, granularity: e.target.value })}>
        <option value="day">Daily</option>
        <option value="week">Weekly</option>
        <option value="month">Monthly</option>
      </select>

      <select aria-label="Comparison" value={params.compare ?? 'none'}
              onChange={(e) => onChange({ ...params, compare: e.target.value })}>
        <option value="none">No comparison</option>
        <option value="prior_period">vs prior period</option>
        <option value="prior_year">vs prior year</option>
      </select>
    </div>
  );
}

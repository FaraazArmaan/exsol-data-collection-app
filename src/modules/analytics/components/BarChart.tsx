import {
  BarChart as RBarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { AXIS_TICK, AXIS_STROKE, GRID_STROKE, CHART_COLORS, formatCents } from '../format';

export function BarChart({ rows, unit = 'cents' }: {
  rows: Array<{ key: string; value: number }>;
  unit?: 'cents' | 'count';
}) {
  const fmt = (v: number) => (unit === 'cents' ? formatCents(v) : String(v));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RBarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="key" tick={AXIS_TICK} stroke={AXIS_STROKE} />
        <YAxis tick={AXIS_TICK} stroke={AXIS_STROKE} width={64}
               tickFormatter={(v) => (unit === 'cents' ? formatCents(Number(v)) : String(v))} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v) => fmt(Number(v))} />
        <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} maxBarSize={72} />
      </RBarChart>
    </ResponsiveContainer>
  );
}

import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { AXIS_TICK, AXIS_STROKE, GRID_STROKE, LINE_COLOR, formatCents } from '../format';

// Thin Recharts wrapper — one of three files allowed to import from 'recharts'.
// `unit` decides tooltip/axis formatting (cents → ₹). A single data point
// renders as a visible dot (a lone point has no line segment to draw).
export function TrendChart({ points, unit = 'cents' }: {
  points: Array<{ x: string; y: number }>;
  unit?: 'cents' | 'count';
}) {
  const single = points.length <= 1;
  const fmt = (v: number) => (unit === 'cents' ? formatCents(v) : String(v));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="x" tick={AXIS_TICK} stroke={AXIS_STROKE} minTickGap={24} />
        <YAxis tick={AXIS_TICK} stroke={AXIS_STROKE} width={64}
               tickFormatter={(v) => (unit === 'cents' ? formatCents(Number(v)) : String(v))} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <Line type="monotone" dataKey="y" stroke={LINE_COLOR} strokeWidth={2}
              dot={single ? { r: 4, fill: LINE_COLOR } : false} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

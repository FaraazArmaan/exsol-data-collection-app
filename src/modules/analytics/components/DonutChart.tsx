import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CHART_COLORS, formatCents } from '../format';

export function DonutChart({ rows, unit = 'cents' }: {
  rows: Array<{ key: string; value: number }>;
  unit?: 'cents' | 'count';
}) {
  const fmt = (v: number) => (unit === 'cents' ? formatCents(v) : String(v));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="key" cx="50%" cy="50%"
             innerRadius={52} outerRadius={82} paddingAngle={1} stroke="none">
          {rows.map((row) => (
            <Cell key={row.key} fill={CHART_COLORS[hashIndex(row.key)]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#a8a39a' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Stable colour per category label (not array index) so a slice keeps its
// colour as the ordering shifts between date ranges.
function hashIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % CHART_COLORS.length;
}

import { BarChart as RBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function BarChart({ rows }: { rows: Array<{ key: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <RBarChart data={rows}>
        <XAxis dataKey="key" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="value" />
      </RBarChart>
    </ResponsiveContainer>
  );
}

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// Thin Recharts wrapper — one of three files allowed to import from 'recharts',
// so swapping the charting library later is local to components/.
export function TrendChart({ points }: { points: Array<{ x: string; y: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points}>
        <XAxis dataKey="x" />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey="y" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

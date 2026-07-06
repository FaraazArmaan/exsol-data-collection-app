import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { CHART_FILL, AXIS_STROKE, GRID_STROKE } from '../format';

export function MovementChart({ series }: { series: { day: string; volume: number }[] }) {
  return (
    <div className="sc-chart" style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={series} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="day" stroke={AXIS_STROKE} tick={{ fontSize: 10 }} interval={4} />
          <YAxis stroke={AXIS_STROKE} tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="volume" fill={CHART_FILL} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { procurementApi } from '../../shared/api';
import type { SpendData } from '../../shared/types';
import { formatMoney } from '../../shared/format';
import { ProcurementTabs } from '../ProcurementTabs';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const AXIS = { fill: '#8a8578', fontSize: 12 };
const GRID = '#2a2a2a';
const ACCENT = '#c9a26a';

// Committed spend trends over 6 months — by supplier, category, and month.
// recharts lives in this page; the route is lazy-loaded so it stays out of the
// main procurement chunk. States: loading / error / empty all handled.
export default function SpendAnalyticsPage(_props: Props) {
  const [data, setData] = useState<SpendData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    procurementApi.spend().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const empty = data && data.overTime.length === 0 && data.bySupplier.length === 0;
  const money = (v: unknown) => formatMoney(Number(v));

  return (
    <div className="proc-shell">
      <div className="proc-header"><h1 className="proc-title">Procurement</h1></div>
      <ProcurementTabs />

      {error && <div className="proc-error" role="alert">{error}</div>}

      {!data && !error ? (
        <p className="proc-muted">Loading…</p>
      ) : empty ? (
        <p className="proc-empty">No committed spend in the last 6 months yet. Order some POs to see trends.</p>
      ) : data ? (
        <div className="proc-charts">
          <section className="proc-chart-card">
            <h2 className="proc-subhead">Spend over time</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.overTime} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={AXIS} stroke={GRID} minTickGap={16} />
                <YAxis tick={AXIS} stroke={GRID} width={78} tickFormatter={money} />
                <Tooltip formatter={money} />
                <Line type="monotone" dataKey="total_cents" stroke={ACCENT} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </section>

          <section className="proc-chart-card">
            <h2 className="proc-subhead">Spend by supplier</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.bySupplier} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={AXIS} stroke={GRID} interval={0} />
                <YAxis tick={AXIS} stroke={GRID} width={78} tickFormatter={money} />
                <Tooltip formatter={money} />
                <Bar dataKey="total_cents" fill={ACCENT} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="proc-chart-card">
            <h2 className="proc-subhead">Spend by category</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.byCategory} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={AXIS} stroke={GRID} interval={0} />
                <YAxis tick={AXIS} stroke={GRID} width={78} tickFormatter={money} />
                <Tooltip formatter={money} />
                <Bar dataKey="total_cents" fill={ACCENT} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

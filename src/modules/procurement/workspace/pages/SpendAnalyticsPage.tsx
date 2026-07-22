import { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { procurementApi } from '../../shared/api';
import type { SpendData } from '../../shared/types';
import { formatMoney } from '../../shared/format';
import { ProcurementTabs } from '../ProcurementTabs';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const AXIS = { fill: 'var(--text-muted)', fontSize: 12 };
const GRID = 'var(--border-subtle)';
const ACCENT = 'var(--accent)';

// Committed spend trends over 6 months — by supplier, category, and month.
// recharts lives in this page; the route is lazy-loaded so it stays out of the
// main procurement chunk. States: loading / error / empty all handled.
export default function SpendAnalyticsPage(_props: Props) {
  const [data, setData] = useState<SpendData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setData(null);
    setError(null);
    procurementApi.spend().then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const empty = data && data.overTime.length === 0 && data.bySupplier.length === 0;
  const money = (v: unknown) => formatMoney(Number(v));

  return (
    <div className="proc-shell">
      <div className="proc-header"><h1 className="proc-title">Procurement</h1></div>
      <ProcurementTabs />

      {error && <ErrorState title="Spend trends could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>}

      {!data && !error ? (
        <LoadingState title="Loading spend trends" />
      ) : empty ? (
        <EmptyState title="No committed spend in the last 6 months yet.">Order some POs to see trends.</EmptyState>
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

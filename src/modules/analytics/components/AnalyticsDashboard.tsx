import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { SalesPanel } from './DomainPanel';
import { useAnalytics } from '../hooks/useAnalytics';
import { salesExportUrl } from '../api';
import type { AnalyticsParams } from '../types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AnalyticsDashboard() {
  const [params, setParams] = useState<AnalyticsParams>({
    from: todayIso(), to: todayIso(), compare: 'none', granularity: 'day',
  });
  const { data, loading, error } = useAnalytics('sales', params);

  return (
    <div className="analytics-dashboard">
      <header><h1>Analytics</h1></header>
      <FilterBar params={params} onChange={setParams} exportHref={salesExportUrl(params, 'xlsx')} />
      {loading && <p>Loading…</p>}
      {error && <p className="analytics-error">Couldn’t load analytics ({error}).</p>}
      {data && <SalesPanel data={data} />}
    </div>
  );
}

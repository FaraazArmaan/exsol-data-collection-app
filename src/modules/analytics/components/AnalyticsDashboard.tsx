import { useState } from 'react';
import '../analytics.css';
import { FilterBar } from './FilterBar';
import { OverviewScorecard } from './OverviewScorecard';
import { DomainSection } from './DomainSection';
import { useAnalytics } from '../hooks/useAnalytics';
import { todayISO, daysAgoISO } from '../format';
import type { AnalyticsParams, DomainKey } from '../types';

// Which domains each bucket unlocks. Order here = render order of panels.
const BUCKET_DOMAINS: Record<string, DomainKey[]> = {
  business: ['sales', 'bookings'],
  customers: ['customers'],
  employees: ['team'],
  products: ['catalog'],
};
const DOMAIN_TITLE: Record<DomainKey, string> = {
  sales: 'Sales', bookings: 'Bookings', customers: 'Customers', team: 'Team', catalog: 'Catalog',
};

export function AnalyticsDashboard() {
  const [params, setParams] = useState<AnalyticsParams>({
    from: daysAgoISO(6), to: todayISO(), compare: 'none', granularity: 'day',
  });
  const overview = useAnalytics('overview', params);

  const buckets: string[] = overview.data?.buckets ?? [];
  const domains: DomainKey[] = [];
  for (const b of buckets) for (const d of BUCKET_DOMAINS[b] ?? []) if (!domains.includes(d)) domains.push(d);

  return (
    <div className="analytics-dashboard">
      <header>
        <h1>Analytics</h1>
        {overview.data?.generatedAt && (
          <span className="analytics-generated">
            Updated {new Date().toLocaleTimeString()}
          </span>
        )}
      </header>

      <FilterBar params={params} onChange={setParams} />

      {overview.loading && <p className="analytics-loading">Loading…</p>}
      {overview.error && (
        <p className="analytics-error">Couldn’t load analytics ({overview.error}).</p>
      )}
      {overview.data && <OverviewScorecard data={overview.data} />}

      {domains.map((d) => (
        <DomainSection key={d} domain={d} title={DOMAIN_TITLE[d]} params={params} />
      ))}
    </div>
  );
}

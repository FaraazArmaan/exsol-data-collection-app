import { useState } from 'react';
import '../analytics.css';
import { FilterBar } from './FilterBar';
import { OverviewScorecard } from './OverviewScorecard';
import { DomainSection } from './DomainSection';
import { useAnalytics } from '../hooks/useAnalytics';
import { useUserAuth } from '../../user-portal/user-auth-context';
import { todayISO, daysAgoISO } from '../format';
import type { AnalyticsParams, DomainKey, Kpi } from '../types';

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

// Domains backed by an optional Module: only surface the panel when that Module
// is enabled for the workspace, else it's a dead "no data" panel. Mirrors the
// Sidebar's `enabledModules.some(m => m.key === …)` gate — one source of truth
// for "is this module on?". sales/customers/team are POS/AMS-intrinsic (ungated).
const DOMAIN_MODULE: Partial<Record<DomainKey, string>> = {
  bookings: 'booking',
  catalog: 'products',
};
// Overview scorecard headline id → backing Module, for the same gating.
const KPI_MODULE: Record<string, string> = {
  catalog: 'products',
};

// Exported pure helper so the gating is unit-testable without a DOM.
export function visibleDomainsFor(
  domains: DomainKey[],
  enabledModuleKeys: ReadonlySet<string>,
): DomainKey[] {
  return domains.filter((d) => {
    const mod = DOMAIN_MODULE[d];
    return !mod || enabledModuleKeys.has(mod);
  });
}

export function AnalyticsDashboard() {
  const [params, setParams] = useState<AnalyticsParams>({
    from: daysAgoISO(6), to: todayISO(), compare: 'none', granularity: 'day',
  });
  const overview = useAnalytics('overview', params);
  const { enabledModules } = useUserAuth();
  const enabledKeys = new Set(enabledModules.map((m) => m.key));

  const buckets: string[] = overview.data?.buckets ?? [];
  const domains: DomainKey[] = [];
  for (const b of buckets) for (const d of BUCKET_DOMAINS[b] ?? []) if (!domains.includes(d)) domains.push(d);
  const visibleDomains = visibleDomainsFor(domains, enabledKeys);

  // Gate the overview scorecard the same way: drop a headline whose backing
  // Module is disabled, so we never headline an empty domain.
  const scorecard = overview.data && {
    ...overview.data,
    kpis: (overview.data.kpis as Kpi[]).filter((k) => {
      const mod = KPI_MODULE[k.id];
      return !mod || enabledKeys.has(mod);
    }),
  };

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
      {scorecard && <OverviewScorecard data={scorecard} />}

      {visibleDomains.map((d) => (
        <DomainSection key={d} domain={d} title={DOMAIN_TITLE[d]} params={params} />
      ))}
    </div>
  );
}

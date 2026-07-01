import type { DomainResponse, OverviewResponse, AnalyticsParams, DomainKey } from './types';

function qs(p: AnalyticsParams): string {
  const u = new URLSearchParams();
  u.set('from', p.from);
  u.set('to', p.to);
  if (p.compare) u.set('compare', p.compare);
  if (p.granularity) u.set('granularity', p.granularity);
  if (p.node) u.set('node', p.node);
  return u.toString();
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

export const fetchOverview = (p: AnalyticsParams) =>
  get<OverviewResponse>(`/api/analytics-overview?${qs(p)}`);

export const fetchDomain = (domain: DomainKey, p: AnalyticsParams) =>
  get<DomainResponse>(`/api/analytics-${domain}?${qs(p)}`);

// Only Sales exposes an export endpoint today; others return undefined so the
// panel omits its Export link.
export function domainExportUrl(domain: DomainKey, p: AnalyticsParams, format: 'xlsx' | 'csv'): string | undefined {
  if (domain !== 'sales') return undefined;
  return `/api/analytics-sales-export?${qs(p)}&format=${format}`;
}

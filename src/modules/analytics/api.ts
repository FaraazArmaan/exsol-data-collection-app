import type { SalesResponse, OverviewResponse, AnalyticsParams } from './types';

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

export const fetchSales = (p: AnalyticsParams) => get<SalesResponse>(`/api/analytics-sales?${qs(p)}`);
export const fetchOverview = (p: AnalyticsParams) => get<OverviewResponse>(`/api/analytics-overview?${qs(p)}`);
export const salesExportUrl = (p: AnalyticsParams, format: 'xlsx' | 'csv') =>
  `/api/analytics-sales-export?${qs(p)}&format=${format}`;

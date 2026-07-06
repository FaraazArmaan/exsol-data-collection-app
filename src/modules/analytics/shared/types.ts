export type Unit = 'cents' | 'count';

export interface Kpi {
  id: string;
  label: string;
  value: number;
  unit: Unit;
  delta?: number | null;
  deltaPct?: number | null;
}
export interface Series {
  id: string;
  label: string;
  chart: 'line' | 'bar';
  unit: Unit;
  points: Array<{ x: string; y: number }>;
}
export interface Breakdown {
  id: string;
  label: string;
  unit: Unit;
  viz: 'bar' | 'donut' | 'table';
  rows: Array<{ key: string; value: number; pct: number }>;
}
export interface Scope {
  isRootScope: boolean;
  nodeCount: number;
}

// Every domain endpoint returns this shape; the generic DomainPanel renders it.
export interface DomainResponse {
  scope: Scope;
  kpis: Kpi[];
  series: Series[];
  breakdowns: Breakdown[];
  generatedAt: string;
}
export type SalesResponse = DomainResponse;

export interface OverviewResponse {
  scope: Scope;
  buckets: string[];
  kpis: Kpi[];
}

export interface AnalyticsParams {
  from: string;
  to: string;
  compare?: string;
  granularity?: string;
  node?: string;
}

export type DomainKey = 'sales' | 'bookings' | 'customers' | 'team' | 'catalog';

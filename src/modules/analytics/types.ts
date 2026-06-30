export interface Kpi {
  id: string;
  label: string;
  value: number;
  unit: 'cents' | 'count';
  delta?: number | null;
  deltaPct?: number | null;
}
export interface Series {
  id: string;
  chart: 'line' | 'bar';
  points: Array<{ x: string; y: number }>;
}
export interface Breakdown {
  id: string;
  label: string;
  rows: Array<{ key: string; value: number; pct: number }>;
}
export interface Scope {
  isRootScope: boolean;
  nodeCount: number;
}
export interface SalesResponse {
  scope: Scope;
  kpis: Kpi[];
  series: Series[];
  breakdowns: Breakdown[];
  generatedAt: string;
}
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

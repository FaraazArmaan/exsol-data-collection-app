// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';

const salesBody = {
  scope: { isRootScope: true, nodeCount: 0 },
  kpis: [{ id: 'revenue', label: 'Revenue', value: 123400, unit: 'cents', deltaPct: 5 }],
  series: [{ id: 'revenue_by_day', label: 'Revenue over time', chart: 'line', unit: 'cents', points: [{ x: '2026-06-01', y: 123400 }] }],
  breakdowns: [{ id: 'by_channel', label: 'Revenue by channel', unit: 'cents', viz: 'bar', rows: [{ key: 'instore', value: 123400, pct: 100 }] }],
  generatedAt: 'x',
};
const overviewBody = {
  scope: { isRootScope: true, nodeCount: 0 },
  buckets: ['business'],
  kpis: [{ id: 'revenue', label: 'Revenue', value: 123400, unit: 'cents' }],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('analytics-overview') ? overviewBody : salesBody),
  })) as any);
});

describe('AnalyticsDashboard', () => {
  it('renders the overview scorecard and the Sales panel after load', async () => {
    render(<AnalyticsDashboard />);
    await waitFor(() => expect(screen.getByText('Sales')).toBeInTheDocument());
    // Revenue label appears once in the overview scorecard and once in the Sales
    // panel KPI row → proves both the overview fetch and the domain fetch rendered.
    expect(screen.getAllByText('Revenue').length).toBeGreaterThanOrEqual(2);
  });
});

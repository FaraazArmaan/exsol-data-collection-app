// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({
      scope: { isRootScope: true, nodeCount: 0 },
      kpis: [{ id: 'revenue', label: 'Revenue', value: 123400, unit: 'cents', deltaPct: 5 }],
      series: [{ id: 'revenue_by_day', chart: 'line', points: [{ x: '2026-06-01', y: 123400 }] }],
      breakdowns: [{ id: 'by_channel', label: 'By channel', rows: [{ key: 'instore', value: 123400, pct: 100 }] }],
      generatedAt: 'x',
    }),
  })) as any);
});

describe('AnalyticsDashboard', () => {
  it('renders the Sales panel with a KPI after load', async () => {
    render(<AnalyticsDashboard />);
    await waitFor(() => expect(screen.getByText('Sales')).toBeInTheDocument());
    expect(screen.getByText('Revenue')).toBeInTheDocument();
  });
});

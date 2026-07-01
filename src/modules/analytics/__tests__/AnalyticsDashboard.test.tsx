// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnalyticsDashboard, visibleDomainsFor } from '../components/AnalyticsDashboard';

// Mutable enabledModules the mocked auth context returns per test.
let enabledModules: Array<{ key: string; label: string }> = [];
vi.mock('../../user-portal/user-auth-context', () => ({
  useUserAuth: () => ({ enabledModules }),
}));

const salesBody = {
  scope: { isRootScope: true, nodeCount: 0 },
  kpis: [{ id: 'revenue', label: 'Revenue', value: 123400, unit: 'cents', deltaPct: 5 }],
  series: [{ id: 'revenue_by_day', label: 'Revenue over time', chart: 'line', unit: 'cents', points: [] }],
  breakdowns: [],
  generatedAt: 'x',
};
const overviewBody = {
  scope: { isRootScope: true, nodeCount: 0 },
  buckets: ['business'], // → sales + bookings domains
  kpis: [{ id: 'revenue', label: 'Revenue', value: 123400, unit: 'cents' }],
};

beforeEach(() => {
  enabledModules = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('analytics-overview') ? overviewBody : salesBody),
  })) as any);
});

describe('visibleDomainsFor (pure gating)', () => {
  it('drops bookings/catalog when their module is disabled', () => {
    const out = visibleDomainsFor(['sales', 'bookings', 'catalog'], new Set(['pos']));
    expect(out).toEqual(['sales']);
  });
  it('keeps them when their module is enabled', () => {
    const out = visibleDomainsFor(['sales', 'bookings', 'catalog'], new Set(['booking', 'products']));
    expect(out).toEqual(['sales', 'bookings', 'catalog']);
  });
});

describe('AnalyticsDashboard module gating', () => {
  it('hides the Bookings panel when the booking module is NOT enabled', async () => {
    enabledModules = [{ key: 'pos', label: 'POS' }]; // no booking
    render(<AnalyticsDashboard />);
    await waitFor(() => expect(screen.getByText('Sales')).toBeInTheDocument());
    expect(screen.queryByText('Bookings')).not.toBeInTheDocument();
  });

  it('shows the Bookings panel when the booking module IS enabled', async () => {
    enabledModules = [{ key: 'booking', label: 'Booking' }];
    render(<AnalyticsDashboard />);
    await waitFor(() => expect(screen.getByText('Bookings')).toBeInTheDocument());
    expect(screen.getByText('Sales')).toBeInTheDocument();
  });
});

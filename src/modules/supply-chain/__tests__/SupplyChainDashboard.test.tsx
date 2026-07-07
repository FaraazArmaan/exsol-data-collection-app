// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SupplyChainDashboard } from '../components/SupplyChainDashboard';

let enabledModules: { key: string; label: string }[] = [];
vi.mock('../../user-portal/user-auth-context', () => ({
  useUserAuth: () => ({ enabledModules }),
}));

const INV = {
  kpis: { lowStockCount: 1, movementVolume30d: 28 },
  lowStock: [{ productId: 'p1', name: 'Shampoo', sku: null, qtyOnHand: 2, reorderLevel: 10, deficit: 8 }],
  movementSeries: [{ day: '2026-07-01', volume: 28 }],
  generatedAt: 'x',
};

beforeEach(() => {
  enabledModules = [];
  const RISK_EMPTY = { risks: [], counts: { high: 0, medium: 0, low: 0 } };
  const CO2_EMPTY = { factors: [], byPo: [], trend: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (
      String(url).includes('inventory') ? INV :
      String(url).includes('risk') ? RISK_EMPTY :
      String(url).includes('co2') ? CO2_EMPTY :
      { kpis: {}, generatedAt: 'x' }
    ),
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe('SupplyChainDashboard', () => {
  it('shows the empty-all state when no backing module is enabled', async () => {
    enabledModules = [];
    await act(async () => { render(<SupplyChainDashboard />); });
    expect(screen.getByText(/Inventory, Procurement, and Manufacturing panels are hidden/i)).toBeInTheDocument();
  });

  it('renders the Inventory section (with data) when inventory is enabled', async () => {
    enabledModules = [{ key: 'inventory', label: 'Inventory' }];
    await act(async () => { render(<SupplyChainDashboard />); });
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Shampoo')).toBeInTheDocument());
    // procurement section absent
    expect(screen.queryByRole('heading', { name: 'Procurement' })).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('inventory') ? INV : { kpis: {}, generatedAt: 'x' }),
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe('SupplyChainDashboard', () => {
  it('shows the empty-all state when no backing module is enabled', () => {
    enabledModules = [];
    render(<SupplyChainDashboard />);
    expect(screen.getByText(/No supply-chain modules are enabled/i)).toBeInTheDocument();
  });

  it('renders the Inventory section (with data) when inventory is enabled', async () => {
    enabledModules = [{ key: 'inventory', label: 'Inventory' }];
    render(<SupplyChainDashboard />);
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Shampoo')).toBeInTheDocument());
    // procurement section absent
    expect(screen.queryByRole('heading', { name: 'Procurement' })).not.toBeInTheDocument();
  });
});

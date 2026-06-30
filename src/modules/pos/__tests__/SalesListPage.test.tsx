// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SalesListPage from '../pages/SalesListPage';

const listFixture = {
  sales: [
    {
      id: 's1', order_no: 42, status: 'fulfilled', channel: 'instore',
      customer_name: 'Riya', customer_phone: '9876543210',
      total_cents: 128050, created_at: '2026-06-12T14:32:00Z',
      line_count: 3, created_by_user_node: 'u1',
    },
    {
      id: 's2', order_no: 41, status: 'pending_payment', channel: 'online',
      customer_name: 'Arjun', customer_phone: '9988776655',
      total_cents: 74000, created_at: '2026-06-12T14:18:00Z',
      line_count: 2, created_by_user_node: 'u1',
    },
  ],
  nextCursor: null,
  summary: { count: 2, revenueCents: 128050, pendingCount: 1, pickupQueueCount: 0 },
};

const detailFixture = {
  id: 's1', order_no: 42, status: 'fulfilled', channel: 'instore',
  customer_name: 'Riya', customer_phone: '9876543210', customer_email: null,
  subtotal_cents: 128050, total_cents: 128050,
  created_at: '2026-06-12T14:32:00Z', paid_at: '2026-06-12T14:33:00Z',
  fulfilled_at: '2026-06-12T14:33:00Z',
  lines: [{ id: 'l1', product_name_snap: 'Cappuccino', qty: 2, line_total_cents: 44000, position: 0 }],
  audit:  [{ op: 'pos.sale.created', actor_user_node: 'u1', detail: null, occurred_at: '2026-06-12T14:32:00Z' }],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation((url: string | URL | Request) => {
    const u = url.toString();
    if (u.includes('/api/pos/sales/s1')) {
      return Promise.resolve(new Response(JSON.stringify(detailFixture), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify(listFixture), { status: 200 }));
  });
});

function renderPage(path = '/c/acme/pos/sales') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/c/:slug/pos/sales"     element={<SalesListPage perms={new Set(['pos.history.view'])} slug="acme" />} />
        <Route path="/c/:slug/pos/sales/:id" element={<SalesListPage perms={new Set(['pos.history.view'])} slug="acme" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SalesListPage', () => {
  it('renders table with formatted order numbers', async () => {
    renderPage();
    expect(await screen.findByText('S-00042')).toBeInTheDocument();
    expect(screen.getByText('S-00041')).toBeInTheDocument();
  });

  it('renders status pills', async () => {
    renderPage();
    await screen.findByText('S-00042');
    expect(screen.getByText(/fulfilled/i)).toBeInTheDocument();
    expect(screen.getByText(/pending pay/i)).toBeInTheDocument();
  });

  it('renders summary cards', async () => {
    renderPage();
    await screen.findByText('S-00042');
    expect(screen.getByText(/sales/i)).toBeInTheDocument();
  });

  it('clicking row opens drawer with detail content', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('S-00042'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Cappuccino', { exact: false })).toBeInTheDocument());
  });

  it('routed directly to /sales/:id auto-opens drawer', async () => {
    renderPage('/c/acme/pos/sales/s1');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows a Storefront badge only on source=storefront rows', async () => {
    const mixed = {
      sales: [
        { id: 'sf', order_no: 3, status: 'pending_payment', channel: 'pickup', source: 'storefront',
          customer_name: 'Guest', customer_phone: '900', total_cents: 100, created_at: '2026-06-30T10:00:00Z', line_count: 1, created_by_user_node: null },
        { id: 'st', order_no: 2, status: 'fulfilled', channel: 'instore', source: 'pos',
          customer_name: 'Walk In', customer_phone: '901', total_cents: 200, created_at: '2026-06-30T09:00:00Z', line_count: 1, created_by_user_node: 'u1' },
      ],
      nextCursor: null,
      summary: { count: 2, revenueCents: 200, pendingCount: 1, pickupQueueCount: 1 },
    };
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(mixed), { status: 200 })));

    renderPage();
    const storefrontRow = (await screen.findByText('S-00003')).closest('tr')!;
    const staffRow = screen.getByText('S-00002').closest('tr')!;
    expect(storefrontRow).toHaveTextContent('Storefront');
    expect(staffRow).not.toHaveTextContent('Storefront');
  });
});

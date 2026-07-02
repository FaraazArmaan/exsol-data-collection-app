// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import StorefrontMenuPage from '../pages/StorefrontMenuPage';
import StorefrontDetailsPage from '../pages/StorefrontDetailsPage';
import StorefrontReceiptPage from '../pages/StorefrontReceiptPage';
import { createGuestCartStore } from '../store/cart';
import { getOrCreateStorefrontSession } from '../lib/session';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks(); });

describe('StorefrontMenuPage', () => {
  it('renders product tiles from the public menu', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {
      tenant: { name: 'Corner Cafe' },
      categories: [],
      products: [{ id: 'p1', name: 'Latte', categoryId: null, salePriceCents: 25000, thumbKey: null }],
    }));
    render(
      <MemoryRouter initialEntries={['/menu/corner-cafe']}>
        <Routes><Route path="/menu/:slug" element={<StorefrontMenuPage />} /></Routes>
      </MemoryRouter>,
    );
    // The branded header (brand/tenant name) is supplied by StorefrontLayout —
    // covered in tests/unit/storefront-layout.test.tsx. Rendered in isolation
    // here, the page itself is only responsible for the menu tiles.
    expect(await screen.findByText('Latte')).toBeInTheDocument();
  });

  it('shows the not-available card on a 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(404, { error: { code: 'storefront_unavailable' } }));
    render(
      <MemoryRouter initialEntries={['/menu/nope']}>
        <Routes><Route path="/menu/:slug" element={<StorefrontMenuPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/isn.t available/i)).toBeInTheDocument();
  });
});

describe('StorefrontDetailsPage', () => {
  it('has a hidden honeypot and submits with honeypot empty, then navigates to the receipt', async () => {
    // Pre-fill the guest cart (same session the page will read).
    const sessionId = getOrCreateStorefrontSession();
    const store = createGuestCartStore('corner-cafe', sessionId);
    store.getState().addLine({ id: 'p1', name: 'Latte', categoryId: null, salePriceCents: 25000, thumbKey: null });
    store.getState().setCustomer({ name: 'Asha', phone: '9990001112' });

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(201, { id: 'sale-xyz', status: 'pending_payment' }));

    render(
      <MemoryRouter initialEntries={['/menu/corner-cafe/details']}>
        <Routes>
          <Route path="/menu/:slug/details" element={<StorefrontDetailsPage />} />
          <Route path="/menu/:slug/order/:saleUuid" element={<div>RECEIPT sale-xyz</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const honeypot = document.querySelector('input[name="company"]') as HTMLInputElement;
    expect(honeypot).toBeTruthy();
    expect(honeypot.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(screen.getByText('RECEIPT sale-xyz')).toBeInTheDocument());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.honeypot).toBe('');
    expect(body.slug).toBe('corner-cafe');
    expect(body.idempotencyKey).toBe(sessionId);
    expect(body.lines).toHaveLength(1);
  });
});

describe('StorefrontReceiptPage', () => {
  it('renders the order number, status pill and items', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {
      id: 'sale-xyz', orderNo: 42, status: 'paid', channel: 'pickup',
      customer: { name: 'Asha', phone: '9990001112', email: null },
      subtotalCents: 25000, discountCents: 0, taxCents: 0, totalCents: 25000,
      lines: [{ productNameSnap: 'Latte', unitPriceCents: 25000, qty: 1, lineTotalCents: 25000, position: 0 }],
      timeline: { placedAt: '2026-06-30T10:00:00Z', paidAt: '2026-06-30T10:05:00Z', fulfilledAt: null, cancelledAt: null, refundedAt: null },
    }));
    render(
      <MemoryRouter initialEntries={['/menu/corner-cafe/order/sale-xyz']}>
        <Routes><Route path="/menu/:slug/order/:saleUuid" element={<StorefrontReceiptPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('S-00042')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText(/Latte ×1/)).toBeInTheDocument();
  });
});

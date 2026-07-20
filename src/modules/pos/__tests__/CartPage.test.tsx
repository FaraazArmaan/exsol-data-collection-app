// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CartPage from '../pages/CartPage';
import { createCartStore } from '../store/cart';

const sampleProduct = (id = 'p1', price = 22000, name = 'Cap') =>
  ({ id, name, categoryId: null, salePriceCents: price, thumbKey: null });
const quote = { quoteId: 'signed-quote-token-which-is-long-enough', lines: [], subtotalCents: 22000, discountCents: 0, taxCents: 0, taxLabel: 'Tax', taxInclusive: false, totalCents: 22000 };

function setup(initial: (s: any) => void) {
  localStorage.clear();
  const useStore = createCartStore('b1', 'u1');
  initial(useStore.getState());
  return render(
    <MemoryRouter initialEntries={['/c/acme/pos/cart']}>
      <Routes>
        <Route path="/c/:slug/pos/cart" element={<CartPage bucketId="b1" userNodeId="u1" slug="acme" />} />
        <Route path="/c/:slug/pos/sales/:id" element={<div>Sale landed</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CartPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(quote), { status: 200 }));
  });

  it('submit disabled when phone empty', () => {
    setup((s) => { s.addLine(sampleProduct()); s.setCustomer({ name: 'R' }); });
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  it('enables submit only after the server quote returns', async () => {
    setup((s) => { s.addLine(sampleProduct()); s.setCustomer({ name: 'R', phone: '9' }); });
    await waitFor(() => expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled());
  });

  it('does NOT render discount/tax rows when zero', () => {
    setup((s) => s.addLine(sampleProduct()));
    expect(screen.queryByText(/discount/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tax/i)).not.toBeInTheDocument();
  });

  it('clicking submit POSTs and navigates to /sales/:id (cart cleared)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    setup((s) => { s.addLine(sampleProduct()); s.setCustomer({ name: 'R', phone: '9' }); });
    await waitFor(() => expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled());
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'sale-xyz' }), { status: 201 }));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getByText('Sale landed')).toBeInTheDocument());
    // Store should be cleared post-success
    const fresh = createCartStore('b1', 'u1');
    expect(fresh.getState().lines).toHaveLength(0);
  });

  it('shows error and keeps cart on API error', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    setup((s) => { s.addLine(sampleProduct()); s.setCustomer({ name: 'R', phone: '9' }); });
    await waitFor(() => expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled());
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'invalid_body' } }), { status: 400 }));
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() =>
      expect(screen.getByText(/invalid_body/i)).toBeInTheDocument()
    );
    // Cart NOT cleared
    const fresh = createCartStore('b1', 'u1');
    expect(fresh.getState().lines).toHaveLength(1);
  });

  it('channel picker switches between instore/online/pickup', () => {
    setup((s) => s.addLine(sampleProduct()));
    fireEvent.click(screen.getByRole('radio', { name: /pickup/i }));
    expect(screen.getByRole('radio', { name: /pickup/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /instore/i })).toHaveAttribute('aria-checked', 'false');
  });
});

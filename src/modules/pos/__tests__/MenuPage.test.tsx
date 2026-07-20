// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MenuPage from '../pages/MenuPage';

const fixture = {
  categories: [{ id: 'c1', name: 'Beverages', productCount: 1 }],
  products: [
    { id: 'p1', name: 'Cappuccino', categoryId: 'c1', salePriceCents: 22000, thumbKey: null },
    { id: 'p2', name: 'Pasta',      categoryId: null, salePriceCents: 52000, thumbKey: null },
  ],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(fixture), { status: 200 })
  );
  localStorage.clear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <MenuPage bucketId="b1" userNodeId="u1" slug="acme" />
    </MemoryRouter>
  );
}

describe('MenuPage', () => {
  it('renders tiles after fetch', async () => {
    renderPage();
    expect(await screen.findByText('Cappuccino')).toBeInTheDocument();
    expect(screen.getByText('Pasta')).toBeInTheDocument();
  });

  it('search filters tiles in-memory (no extra fetch)', async () => {
    renderPage();
    await screen.findByText('Cappuccino');
    fireEvent.change(screen.getByPlaceholderText(/filter menu/i), { target: { value: 'pas' } });
    expect(screen.queryByText('Cappuccino')).not.toBeInTheDocument();
    expect(screen.getByText('Pasta')).toBeInTheDocument();
  });

  it('tile click adds to cart and side panel shows total', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Cappuccino'));
    await waitFor(() =>
      expect(screen.getByTestId('side-cart-total')).toHaveTextContent('₹220')
    );
  });

  it('adds the chosen variant as a distinct cart line', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      categories: [],
      products: [{
        id: 'shirt', name: 'Tee', categoryId: null, salePriceCents: 20000, thumbKey: null,
        variants: [{ id: 'shirt-l', title: 'Large', salePriceCents: 24000 }],
      }],
    }), { status: 200 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Tee, Large' }));
    await waitFor(() => expect(screen.getByText('Tee — Large')).toBeInTheDocument());
    expect(screen.getByTestId('side-cart-total')).toHaveTextContent('₹240');
  });

  it('shows empty-state side cart when nothing added', async () => {
    renderPage();
    await screen.findByText('Cappuccino');
    expect(screen.getByText(/tap items to start an order/i)).toBeInTheDocument();
  });

  it('side cart can decrease quantity and remove an item (no more stacking-only)', async () => {
    renderPage();
    await screen.findByLabelText('Add Cappuccino');
    fireEvent.click(screen.getByLabelText('Add Cappuccino'));
    fireEvent.click(screen.getByLabelText('Add Cappuccino')); // qty 2 → ₹440
    await waitFor(() => expect(screen.getByTestId('side-cart-total')).toHaveTextContent('₹440'));

    fireEvent.click(screen.getByLabelText('Decrease')); // qty 1 → ₹220
    await waitFor(() => expect(screen.getByTestId('side-cart-total')).toHaveTextContent('₹220'));

    fireEvent.click(screen.getByLabelText('Remove')); // gone → empty state
    await waitFor(() =>
      expect(screen.getByText(/tap items to start an order/i)).toBeInTheDocument()
    );
  });
});

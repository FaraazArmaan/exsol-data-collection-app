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

  it('shows empty-state side cart when nothing added', async () => {
    renderPage();
    await screen.findByText('Cappuccino');
    expect(screen.getByText(/tap items to start an order/i)).toBeInTheDocument();
  });
});

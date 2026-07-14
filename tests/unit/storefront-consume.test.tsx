/** @vitest-environment jsdom */
import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import StorefrontLayout from '../../src/modules/pos/pages/StorefrontLayout';
import StorefrontMenuPage from '../../src/modules/pos/pages/StorefrontMenuPage';
import StorefrontCartPage from '../../src/modules/pos/pages/StorefrontCartPage';

const BRAND = {
  name: 'Papas Saloon', logoUrl: null, logoAltUrl: null, faviconUrl: null,
  appIconUrl: null, socialUrl: null, heroUrls: [], accent: null,
  theme: 'dark', fontHeading: null, fontBody: null,
};

// One fetch mock that routes by URL: brand resolves, menu 404s (storefront
// unavailable). Mirrors the real Edge split — brand and menu are separate
// endpoints, and the storefront's availability rides on the MENU fetch.
function mockFetch({ menuStatus }: { menuStatus: number }) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public/brand/')) {
      return new Response(JSON.stringify(BRAND), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/public/menu/')) {
      return menuStatus === 200
        ? new Response(JSON.stringify({ tenant: { name: 'Papas Saloon' }, categories: [], products: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: menuStatus, headers: { 'content-type': 'application/json' } });
    }
    return new Response('nope', { status: 404 });
  }) as never;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.querySelectorAll('link[data-brand-shell="1"]').forEach((el) => el.remove());
});

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/storefront/:slug" element={<StorefrontLayout />}>
          <Route index element={<StorefrontMenuPage />} />
          <Route path="cart" element={<StorefrontCartPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('storefront pages consume the shared BrandShell (no local StorefrontShell)', () => {
  test('menu-fetch 404 renders NotAvailableCard as content inside the one branded shell', async () => {
    mockFetch({ menuStatus: 404 });
    const { container } = renderRoute('/storefront/papas');
    await waitFor(() => expect(screen.getByText(/isn.t available here/i)).toBeTruthy());
    // Exactly one shell — the shared brand shell — and NOT the legacy local one.
    expect(container.querySelectorAll('.brand-shell')).toHaveLength(1);
    expect(container.querySelector('.storefront-shell')).toBeNull();
  });

  test('cart page renders its content inside the branded shell, no local StorefrontShell', async () => {
    mockFetch({ menuStatus: 200 });
    const { container } = renderRoute('/storefront/papas/cart');
    await waitFor(() => expect(container.querySelector('.pos-cart-page')).not.toBeNull());
    expect(container.querySelector('.brand-shell')).not.toBeNull();
    expect(container.querySelector('.storefront-shell')).toBeNull();
  });
});

/** @vitest-environment jsdom */
import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import StorefrontLayout from '../../src/modules/pos/pages/StorefrontLayout';

const BRAND = {
  name: 'Papas Saloon',
  logoUrl: null,
  logoAltUrl: null,
  faviconUrl: null,
  appIconUrl: null,
  socialUrl: null,
  heroUrls: [],
  accent: null,
  theme: 'light',
  fontHeading: null,
  fontBody: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.querySelectorAll('link[data-brand-shell="1"]').forEach((el) => el.remove());
});

function renderAt(path = '/storefront/papas') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/storefront/:slug" element={<StorefrontLayout />}>
          <Route index element={<div>MENU_CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('StorefrontLayout', () => {
  test('wraps outlet content in BrandShell and applies the fetched brand', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(BRAND), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as never;
    const { container } = renderAt();
    // Outlet child renders through the layout
    expect(screen.getByText('MENU_CONTENT')).toBeTruthy();
    // Shared brand chrome present (not the legacy .storefront-shell)
    expect(container.querySelector('.brand-shell')).not.toBeNull();
    expect(container.querySelector('.storefront-shell')).toBeNull();
    // Brand applied once the fetch resolves
    await waitFor(() =>
      expect(container.querySelector('.brand-shell')?.getAttribute('data-theme')).toBe('light'),
    );
    expect(container.textContent).toContain('Papas Saloon');
  });

  test('renders outlet content best-effort even when the brand fetch 404s (never gated on !brand)', async () => {
    global.fetch = vi.fn(async () => new Response('no', { status: 404 })) as never;
    const { container } = renderAt();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // Storefront content still renders; shell falls back to the fallbackName
    expect(screen.getByText('MENU_CONTENT')).toBeTruthy();
    expect(container.querySelector('.brand-shell')).not.toBeNull();
    expect(container.textContent).toContain('Online ordering');
  });

  test('fetches the brand for the route slug', async () => {
    const f = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(JSON.stringify(BRAND), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    global.fetch = f as never;
    renderAt('/storefront/papas');
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls.some(([url]) => String(url).includes('/api/public/brand/papas'))).toBe(
      true,
    );
  });
});

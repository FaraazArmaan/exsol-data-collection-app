/** @vitest-environment jsdom */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import AdminWorkspaceBrandingCard from '../../src/modules/branding/AdminWorkspaceBrandingCard';
import WorkspaceBrandingCard from '../../src/modules/branding/WorkspaceBrandingCard';
import { UserAuthCtxForTesting } from '../../src/modules/user-portal/user-auth-context';

const SAMPLE_BRAND = { name: 'Acme', logoUrl: null, logoAltUrl: null, faviconUrl: null, appIconUrl: null, socialUrl: null, heroUrls: [], accent: null, theme: 'dark', fontHeading: null, fontBody: null };

beforeEach(() => {
  global.fetch = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/public/brand/')) {
      return new Response(JSON.stringify(SAMPLE_BRAND), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  }) as never;
});
afterEach(() => { vi.restoreAllMocks(); cleanup(); });

function withAuth(opts: { permissions: Record<string, true>; level_number?: number | null; slug?: string }) {
  return (
    <UserAuthCtxForTesting.Provider value={{
      user: { id: 'u-1', display_name: 'T', email: 't@x', level_number: opts.level_number ?? 5 } as never,
      client: { id: 'c-1', slug: opts.slug ?? 'acme', name: 'Acme' } as never,
      permissions: opts.permissions as never, enabledModules: [], loading: false,
      refresh: async () => {}, signOut: async () => {},
    }}>
      <WorkspaceBrandingCard />
    </UserAuthCtxForTesting.Provider>
  );
}

describe('WorkspaceBrandingCard visibility', () => {
  test('renders with _platform.settings.edit', async () => {
    render(withAuth({ permissions: { '_platform.settings.edit': true } }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /branding/i })).toBeTruthy());
  });
  test('null when no perm and level > 1', () => {
    const { container } = render(withAuth({ permissions: {}, level_number: 5 }));
    expect(container.textContent).toBe('');
  });
  test('L1 bypass renders without explicit perm', async () => {
    render(withAuth({ permissions: {}, level_number: 1 }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /branding/i })).toBeTruthy());
  });
});

describe('AdminWorkspaceBrandingCard', () => {
  test('renders and a theme change PATCHes with ?client=<id>', async () => {
    render(<AdminWorkspaceBrandingCard clientId="c-1234" slug="acme" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /branding/i })).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/light theme/i));
    await waitFor(() => {
      const calls = (global.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
      const patch = calls.find(([u, o]) => typeof u === 'string' && u.includes('/api/client-settings/brand') && o?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect((patch![0] as string)).toContain('client=c-1234');
    });
  });
});

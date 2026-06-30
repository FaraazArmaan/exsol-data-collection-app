// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserAuthCtxForTesting } from '../../user-portal/user-auth-context';
import StorefrontSettings from '../pages/StorefrontSettings';

function authValue(over: Record<string, unknown>) {
  return {
    user: null, client: { id: 'b1', slug: 'cafe', name: 'Cafe' },
    permissions: {}, enabledModules: [], loading: false,
    refresh: async () => {}, signOut: async () => {}, ...over,
  } as any;
}

beforeEach(() => vi.restoreAllMocks());

function mockToggleApi(initialEnabled: boolean) {
  return vi.spyOn(global, 'fetch').mockImplementation((_url: any, init?: any) => {
    const enabled = init?.method === 'PATCH' ? JSON.parse(init.body).enabled : initialEnabled;
    return Promise.resolve(new Response(
      JSON.stringify({ enabled, publicUrl: 'https://exsol.app/menu/cafe' }),
      { status: 200 },
    ));
  });
}

describe('StorefrontSettings', () => {
  it('L1 Owner toggles on and sees the public link', async () => {
    mockToggleApi(false);
    render(
      <UserAuthCtxForTesting.Provider value={authValue({ user: { id: 'u1', level_number: 1 } })}>
        <StorefrontSettings />
      </UserAuthCtxForTesting.Provider>,
    );
    const sw = await screen.findByRole('switch', { name: 'Public storefront' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByText('https://exsol.app/menu/cafe')).toBeInTheDocument();
  });

  it('denies a non-Owner without settings.edit', async () => {
    render(
      <UserAuthCtxForTesting.Provider value={authValue({ user: { id: 'u2', level_number: 2 }, permissions: {} })}>
        <StorefrontSettings />
      </UserAuthCtxForTesting.Provider>,
    );
    expect(await screen.findByText(/don.t have access/i)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserAuthCtxForTesting } from '../../user-portal/user-auth-context';
import StorefrontSettings from '../pages/StorefrontSettings';

function authValue(over: Record<string, unknown>) {
  return {
    user: null,
    client: { id: 'b1', slug: 'cafe', name: 'Cafe' },
    permissions: {},
    enabledModules: [],
    loading: false,
    refresh: async () => {},
    signOut: async () => {},
    ...over,
  } as any;
}

beforeEach(() => vi.restoreAllMocks());

function mockToggleApi(orderingEnabled = false, bookingEnabled = false, bookingReady = true) {
  return vi.spyOn(global, 'fetch').mockImplementation((url: any, init?: any) => {
    const booking = String(url).includes('/api/booking/publication');
    const enabled = init?.method
      ? JSON.parse(init.body).enabled
      : booking
        ? bookingEnabled
        : orderingEnabled;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          enabled,
          ready: booking ? bookingReady : true,
          publicUrl: booking
            ? 'https://exsol.app/book/cafe'
            : 'https://exsoldatacollectionapp.netlify.app/storefront/cafe',
        }),
        { status: 200 },
      ),
    );
  });
}

describe('StorefrontSettings', () => {
  it('L1 Owner independently enables online ordering and booking', async () => {
    mockToggleApi();
    render(
      <UserAuthCtxForTesting.Provider value={authValue({ user: { id: 'u1', level_number: 1 } })}>
        <StorefrontSettings />
      </UserAuthCtxForTesting.Provider>,
    );
    const ordering = await screen.findByRole('switch', { name: 'Online ordering' });
    const booking = screen.getByRole('switch', { name: 'Online booking' });
    expect(ordering).toHaveAttribute('aria-checked', 'false');
    expect(booking).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(ordering);
    await waitFor(() => expect(ordering).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(booking);
    await waitFor(() => expect(booking).toHaveAttribute('aria-checked', 'true'));
    expect(
      screen.getByText('https://exsoldatacollectionapp.netlify.app/storefront/cafe'),
    ).toBeInTheDocument();
    expect(screen.getByText('https://exsol.app/book/cafe')).toBeInTheDocument();
  });

  it('shows Booking as unavailable until its setup is ready', async () => {
    mockToggleApi(false, false, false);
    render(
      <UserAuthCtxForTesting.Provider value={authValue({ user: { id: 'u1', level_number: 1 } })}>
        <StorefrontSettings />
      </UserAuthCtxForTesting.Provider>,
    );
    expect(await screen.findByText(/complete booking setup/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Online booking' })).toBeDisabled();
  });

  it('denies a non-Owner without settings.edit', async () => {
    render(
      <UserAuthCtxForTesting.Provider
        value={authValue({ user: { id: 'u2', level_number: 2 }, permissions: {} })}
      >
        <StorefrontSettings />
      </UserAuthCtxForTesting.Provider>,
    );
    expect(await screen.findByText(/don.t have access/i)).toBeInTheDocument();
  });
});

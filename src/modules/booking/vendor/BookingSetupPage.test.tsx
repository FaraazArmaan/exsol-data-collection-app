// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../shared/api', () => ({
  BookingApiError: class BookingApiError extends Error {},
  bookingApi: { getSetup: vi.fn() },
}));
vi.mock('./BookingTabs', () => ({ BookingTabs: () => <nav>Booking navigation</nav> }));

import { bookingApi } from '../shared/api';
import BookingSetupPage from './BookingSetupPage';

describe('BookingSetupPage', () => {
  it('keeps a completed setup out of the first wizard step after remounting', async () => {
    vi.mocked(bookingApi.getSetup).mockResolvedValue({
      booking_party_mode: 'nobody_specific',
      bookable_kinds: ['appointment'],
      extra_capacity_needs: [],
      availability_source: 'manual',
      display_labels: { team: '', space: '', equipment: '' },
      reservation_rules: {
        requires_team_member: false,
        allows_any_team_member: false,
        requires_space: false,
        requires_equipment: false,
        availability_source: 'manual',
      },
      visible_sections: [{ key: 'rules', label: 'Booking Rules' }],
      completed_at: '2026-07-15T00:00:00.000Z',
      setup_version: 1,
      is_first_visit: false,
    });

    render(
      <MemoryRouter>
        <BookingSetupPage slug="cafe" perms={new Set(['booking.employees.edit'])} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Your booking setup is ready')).toBeInTheDocument();
    expect(screen.queryByText(/Step 1 of 5/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Storefront' })).toHaveAttribute(
      'href',
      '/c/cafe/pos/settings',
    );
  });
});

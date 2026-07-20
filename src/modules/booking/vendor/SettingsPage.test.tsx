// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../shared/api', () => ({
  BookingApiError: class BookingApiError extends Error {},
  bookingApi: { getSettings: vi.fn(), getSetup: vi.fn(), putSettings: vi.fn() },
}));
vi.mock('./BookingTabs', () => ({ BookingTabs: () => <nav>Booking navigation</nav> }));

import { bookingApi } from '../shared/api';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  it('opens a closed day with clear default hours and explains Workforce overlap', async () => {
    vi.mocked(bookingApi.getSettings).mockResolvedValue({
      slot_interval_min: 15,
      lead_time_min: 0,
      cancel_cutoff_min: 0,
      weekly_schedule: {},
      date_overrides: [],
    });
    vi.mocked(bookingApi.getSetup).mockResolvedValue({
      booking_party_mode: 'any_team_member',
      bookable_kinds: ['appointment'],
      extra_capacity_needs: [],
      availability_source: 'workforce',
      display_labels: {
        team: 'Team Availability',
        space: 'Rooms & Spaces',
        equipment: 'Equipment',
      },
      reservation_rules: {
        requires_team_member: true,
        allows_any_team_member: true,
        requires_space: false,
        requires_equipment: false,
        availability_source: 'workforce',
      },
      visible_sections: [],
      completed_at: '2026-07-15T00:00:00.000Z',
      setup_version: 1,
      is_first_visit: false,
    });

    render(
      <MemoryRouter>
        <SettingsPage slug="cafe" perms={new Set(['booking.employees.edit'])} />
      </MemoryRouter>,
    );

    const openMonday = await screen.findByRole('button', { name: 'Set Monday open' });
    expect(
      screen.getByText(/Team availability also requires Workforce shifts/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Staff & Schedule' })).toHaveAttribute(
      'href',
      '/c/cafe/workforce',
    );

    fireEvent.click(openMonday);
    expect(openMonday).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /monday opening time: 9:00 am/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /monday closing time: 5:00 pm/i })).toBeInTheDocument();
  });
});

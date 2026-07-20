// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock('../shared/api', () => ({ bookingApi: { list: listMock } }));
vi.mock('../format', () => ({
  formatDateLong: () => '20 July 2026',
  formatRupees: () => '₹500',
  formatTime: () => '10:00',
  isoDatePlus: () => '2026-07-20',
}));
vi.mock('../components/BookingStatusPill', () => ({ BookingStatusPill: ({ status }: { status: string }) => <span>{status}</span> }));
vi.mock('./BookingTabs', () => ({ BookingTabs: () => <nav aria-label="Booking navigation">Booking tabs</nav> }));
vi.mock('./BookingDetailDrawer', () => ({ BookingDetailDrawer: ({ bookingId }: { bookingId: string }) => <div role="dialog">Booking {bookingId}</div> }));

import BookingsListPage from './BookingsListPage';

const booking = {
  id: 'booking-1', service_id: null, resource_id: 'resource-1', user_node_id: null,
  start_at: '2026-07-20T10:00:00.000Z', end_at: '2026-07-20T10:30:00.000Z', status: 'confirmed',
  customer_name: 'Mira Shah', customer_phone: null, customer_email: null, price_cents: 50000,
};

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ bookings: [booking] });
});

describe('BookingsListPage shared table adoption', () => {
  it('uses a semantic table and an explicit keyboard-accessible action to open details', async () => {
    render(<BookingsListPage slug="acme" perms={new Set(['booking.customers.view'])} />);

    expect(await screen.findByRole('table', { name: /bookings in the selected date range/i })).toBeInTheDocument();
    const viewDetails = screen.getByRole('button', { name: /view details for booking on 20 july 2026/i });
    expect(viewDetails).toHaveTextContent('View details');
    fireEvent.click(viewDetails);
    expect(screen.getByRole('dialog')).toHaveTextContent('Booking booking-1');
  });

  it('keeps a failed load distinct from an empty result and offers retry', async () => {
    listMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ bookings: [] });
    render(<BookingsListPage slug="acme" perms={new Set(['booking.customers.view'])} />);

    expect(await screen.findByText('Could not load bookings.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No bookings in this range.')).toBeInTheDocument());
  });
});

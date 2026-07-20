// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../shared/api', () => ({
  bookingApi: { get: getMock, transition: vi.fn(), reschedule: vi.fn(), recordCash: vi.fn(), checkIn: vi.fn() },
}));
vi.mock('../format', () => ({ formatRupees: () => '₹500', formatTime: () => '10:00', formatDateLong: () => '18 July 2026' }));

import { BookingDetailDrawer } from './BookingDetailDrawer';

describe('BookingDetailDrawer', () => {
  it('uses the shared drawer lifecycle while preserving booking detail loading', async () => {
    getMock.mockResolvedValueOnce({ id: 'booking-1', status: 'confirmed', start_at: '2026-07-18T10:00:00.000Z', end_at: '2026-07-18T11:00:00.000Z', customer_name: 'Mira Shah', customer_phone: null, price_cents: 50000, payment_status: 'paid', events: [] });
    const onClose = vi.fn();
    render(<BookingDetailDrawer bookingId="booking-1" perms={new Set()} onClose={onClose} onChanged={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Booking detail' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Mira Shah')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

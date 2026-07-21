// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServiceMock, listResourcesMock, listServicesMock } = vi.hoisted(() => ({
  createServiceMock: vi.fn(),
  listResourcesMock: vi.fn(),
  listServicesMock: vi.fn(),
}));

vi.mock('../shared/api', () => ({
  BookingApiError: class BookingApiError extends Error {},
  bookingApi: { createService: createServiceMock, deleteService: vi.fn(), patchService: vi.fn(), listResources: listResourcesMock, listServices: listServicesMock },
}));
vi.mock('../format', () => ({ formatRupees: (value: number) => `₹${value}` }));
vi.mock('../config', () => ({ ONLINE_PAYMENTS_ENABLED: false }));
vi.mock('./BookingTabs', () => ({ BookingTabs: () => <nav aria-label="Booking navigation">Booking tabs</nav> }));
import ServicesPage from './ServicesPage';

describe('ServicesPage shared form adoption', () => {
  beforeEach(() => {
    createServiceMock.mockReset().mockResolvedValue({});
    listServicesMock.mockReset().mockResolvedValue({ services: [] });
    listResourcesMock.mockReset().mockResolvedValue({ resources: [{ id: 'resource-1', name: 'Aditya' }, { id: 'resource-2', name: 'Aisha' }] });
  });

  it('keeps resource selection compact and submits the selected canonical resource ids', async () => {
    render(<ServicesPage slug="acme" perms={new Set(['booking.employees.edit'])} />);

    fireEvent.click(await screen.findByRole('button', { name: /add service/i }));
    const drawer = await screen.findByRole('dialog', { name: /add service/i });
    const name = within(drawer).getByLabelText(/name/i);
    expect(within(drawer).getByText(/eligible resources/i)).toBeInTheDocument();
    fireEvent.change(name, { target: { value: 'Consultation' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Choose resources' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Aditya' }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add service' }));

    await waitFor(() => expect(createServiceMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Consultation',
      duration_min: 30,
      eligible_resource_ids: ['resource-1'],
    })));
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VendorResource, VendorService } from '../shared/api';

vi.mock('../shared/api', () => ({ bookingApi: { manualCreate: vi.fn() } }));

import { ManualBookingDrawer } from './ManualBookingDrawer';

const resources: VendorResource[] = [
  { id: 'aditya', name: 'Aditya', weekly_schedule: {}, active: true },
  { id: 'maya', name: 'Maya', weekly_schedule: {}, active: true },
];

const services: VendorService[] = [
  {
    id: 'audit', name: 'Audit', duration_min: 30, price_cents: 0,
    payment_mode: 'pay_at_venue', deposit_cents: null, buffer_min: 0,
    active: true, eligible_resource_ids: ['maya'],
  },
  {
    id: 'consultation', name: 'Consultation', duration_min: 30, price_cents: 0,
    payment_mode: 'pay_at_venue', deposit_cents: null, buffer_min: 0,
    active: true, eligible_resource_ids: [],
  },
];

describe('ManualBookingDrawer', () => {
  it('uses the shared date and time controls instead of a combined browser picker', () => {
    render(
      <ManualBookingDrawer services={services} resources={resources} onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: /start date: choose date/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start time: choose time/i })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/dd\/mm\/yyyy/i)).not.toBeInTheDocument();
  });

  it('only permits resources eligible for the selected service', async () => {
    const user = userEvent.setup();
    render(
      <ManualBookingDrawer
        services={services}
        resources={resources}
        defaultResourceId="aditya"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    const resource = screen.getByLabelText('Resource') as HTMLSelectElement;
    expect(await screen.findByRole('option', { name: 'Maya' })).toBeInTheDocument();
    await waitFor(() => expect(resource).toHaveValue('maya'));
    expect(screen.queryByRole('option', { name: 'Aditya' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Service'), 'consultation');
    expect(screen.getByRole('option', { name: 'Aditya' })).toBeInTheDocument();
    await user.selectOptions(resource, 'aditya');

    await user.selectOptions(screen.getByLabelText('Service'), 'audit');
    await waitFor(() => expect(resource).toHaveValue('maya'));

    await user.click(screen.getByRole('checkbox', { name: /block staff time/i }));
    expect(screen.getByRole('option', { name: 'Aditya' })).toBeInTheDocument();
  });
});

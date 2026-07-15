// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../shared/api', () => ({
  PaymentsApiError: class PaymentsApiError extends Error {},
  paymentsApi: { providerConnection: vi.fn(), updateProviderConnection: vi.fn() },
}));

import { paymentsApi } from '../shared/api';
import PaymentProviderSettingsCard from './PaymentProviderSettingsCard';

const configured = {
  provider: 'razorpay' as const, mode: 'test' as const, enabled: true, configured: true,
  key_id_configured: true, api_secret_configured: true, webhook_secret_configured: true, updated_at: null,
};

beforeEach(() => {
  vi.mocked(paymentsApi.providerConnection).mockResolvedValue(configured);
  vi.mocked(paymentsApi.updateProviderConnection).mockResolvedValue(configured);
});

describe('PaymentProviderSettingsCard', () => {
  it('shows saved-state only, then submits newly entered write-only credentials', async () => {
    render(<PaymentProviderSettingsCard />);
    expect(await screen.findByText('Credentials saved')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('api-test-secret')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Test Key ID'), { target: { value: 'rzp_test_newkey' } });
      fireEvent.change(screen.getByLabelText('Test Key Secret'), { target: { value: 'new-api-secret' } });
      fireEvent.change(screen.getByLabelText('Test webhook secret'), { target: { value: 'new-webhook-secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Test connection' }));
    });
    await vi.waitFor(() => expect(paymentsApi.updateProviderConnection).toHaveBeenCalledWith({
      enabled: true, key_id: 'rzp_test_newkey', api_secret: 'new-api-secret', webhook_secret: 'new-webhook-secret',
    }));
  });
});

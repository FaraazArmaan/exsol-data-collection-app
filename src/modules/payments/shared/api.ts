import type { PaymentProviderConnection, PaymentsDashboard } from './types';

export class PaymentsApiError extends Error {
  constructor(public status: number, public code: string) {
    super(`${code} (${status})`);
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await res.json().catch(() => null) as { error?: { code?: string } } | null;
  if (!res.ok) throw new PaymentsApiError(res.status, body?.error?.code ?? 'http_error');
  return body as T;
}

export const paymentsApi = {
  dashboard: () => jsonFetch<PaymentsDashboard>('/api/payments/dashboard'),
  providerConnection: () => jsonFetch<PaymentProviderConnection>('/api/payments/provider-connection'),
  updateProviderConnection: (body: {
    enabled?: boolean;
    key_id?: string | null;
    api_secret?: string | null;
    webhook_secret?: string | null;
  }) => jsonFetch<PaymentProviderConnection>('/api/payments/provider-connection', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
};

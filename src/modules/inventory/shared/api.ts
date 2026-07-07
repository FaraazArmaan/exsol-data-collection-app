// Throw-on-error inventory API client. Mirrors products/shared/api.ts: parse the
// body as text-then-safe-JSON, throw a typed error carrying the server's error
// code on any non-2xx so callers can surface it.
import type {
  AdjustResult, ByLocationData, DashboardData, InventoryReturn, LifecycleState, Movement,
  ProductLocations, ReturnDisposition, StockRow,
} from './types';

export class InventoryApiError extends Error {
  constructor(public status: number, public code: string, public detail: unknown) {
    super(`${code} (${status})`);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code?: string } } | null)?.error;
    throw new InventoryApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export const inventoryApi = {
  dashboard: () => jsonFetch<DashboardData>('/api/inventory/dashboard'),
  byLocation: () => jsonFetch<ByLocationData>('/api/inventory/by-location'),
  productLocations: (productId: string) =>
    jsonFetch<ProductLocations>(`/api/inventory/product-locations?product_id=${encodeURIComponent(productId)}`),
  list: (q: string, state = '') => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (state) params.set('state', state);
    const qs = params.toString();
    return jsonFetch<{ items: StockRow[] }>(`/api/inventory/list${qs ? `?${qs}` : ''}`);
  },
  setLifecycle: (body: { product_id: string; state: LifecycleState }) =>
    jsonFetch<{ product_id: string; lifecycle_state: LifecycleState; storefront_hidden: boolean }>(
      '/api/inventory/lifecycle', { method: 'POST', body: JSON.stringify(body) },
    ),
  adjust: (body: { product_id: string; qty_delta: number; reason: string }) =>
    jsonFetch<AdjustResult>('/api/inventory/adjust', { method: 'POST', body: JSON.stringify(body) }),
  movements: (productId: string) =>
    jsonFetch<{ movements: Movement[] }>(`/api/inventory/movements?product_id=${encodeURIComponent(productId)}`),
  listReturns: () => jsonFetch<{ returns: InventoryReturn[] }>('/api/inventory/returns'),
  createReturn: (body: { product_id: string; qty: number; disposition: ReturnDisposition; reason: string }) =>
    jsonFetch<{ ok: true; disposition: ReturnDisposition; qty_on_hand?: number }>(
      '/api/inventory/returns', { method: 'POST', body: JSON.stringify(body) },
    ),
};

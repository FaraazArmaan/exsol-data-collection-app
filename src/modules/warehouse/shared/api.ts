// Throw-on-error Warehouse API client. Mirrors inventory/shared/api.ts: parse the
// body as text-then-safe-JSON, throw a typed error carrying the server's error
// code on any non-2xx so callers can surface it.
import type { StockRow, TransferResult, WarehouseLocation } from './types';

export class WarehouseApiError extends Error {
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
    throw new WarehouseApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export const warehouseApi = {
  listLocations: () =>
    jsonFetch<{ locations: WarehouseLocation[] }>('/api/warehouse/locations'),
  createLocation: (body: { name: string; kind: string }) =>
    jsonFetch<{ location: WarehouseLocation }>('/api/warehouse/locations', {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateLocation: (id: string, body: { name?: string; kind?: string }) =>
    jsonFetch<{ location: WarehouseLocation }>(`/api/warehouse/location/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
  deleteLocation: (id: string) =>
    jsonFetch<null>(`/api/warehouse/location/${id}`, { method: 'DELETE' }),
  stock: (locationId?: string) =>
    jsonFetch<{ items: StockRow[] }>(
      `/api/warehouse/stock${locationId ? `?location_id=${encodeURIComponent(locationId)}` : ''}`,
    ),
  transfer: (body: { product_id: string; from_location_id: string; to_location_id: string; qty: number }) =>
    jsonFetch<TransferResult>('/api/warehouse/transfer', {
      method: 'POST', body: JSON.stringify(body),
    }),
};

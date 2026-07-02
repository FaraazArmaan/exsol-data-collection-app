// Throw-on-error inventory API client. Mirrors products/shared/api.ts: parse the
// body as text-then-safe-JSON, throw a typed error carrying the server's error
// code on any non-2xx so callers can surface it.
import type { AdjustResult, Movement, StockRow } from './types';

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
  list: (q: string) =>
    jsonFetch<{ items: StockRow[] }>(`/api/inventory/list${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  adjust: (body: { product_id: string; qty_delta: number; reason: string }) =>
    jsonFetch<AdjustResult>('/api/inventory/adjust', { method: 'POST', body: JSON.stringify(body) }),
  movements: (productId: string) =>
    jsonFetch<{ movements: Movement[] }>(`/api/inventory/movements?product_id=${encodeURIComponent(productId)}`),
};

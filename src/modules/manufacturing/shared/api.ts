import type { BomListItem, BomDetail, ProductionOrder, ProductPick } from './types';

export class ManufacturingApiError extends Error {
  constructor(public status: number, public code: string, public detail: unknown) {
    super(`${code} (${status})`);
  }
}

function safeJson(text: string): unknown { try { return JSON.parse(text); } catch { return text; } }

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
    throw new ManufacturingApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export const manufacturingApi = {
  listBoms: () => jsonFetch<{ items: BomListItem[] }>('/api/manufacturing/boms'),
  getBom: (id: string) => jsonFetch<BomDetail>(`/api/manufacturing/bom-detail/${id}`),
  createBom: (body: { name: string; output_product_id: string; components: { product_id: string; qty: number }[] }) =>
    jsonFetch<{ id: string }>('/api/manufacturing/boms', { method: 'POST', body: JSON.stringify(body) }),
  updateBom: (id: string, body: { name?: string; components: { product_id: string; qty: number }[] }) =>
    jsonFetch<{ id: string }>(`/api/manufacturing/bom-detail/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteBom: (id: string) =>
    jsonFetch<{ id: string; deleted: boolean }>(`/api/manufacturing/bom-detail/${id}`, { method: 'DELETE' }),
  listOrders: () => jsonFetch<{ items: ProductionOrder[] }>('/api/manufacturing/orders'),
  createOrder: (body: { bom_id: string; qty: number }) =>
    jsonFetch<{ id: string; status: string }>('/api/manufacturing/orders', { method: 'POST', body: JSON.stringify(body) }),
  advanceOrder: (id: string, to: string) =>
    jsonFetch<{ id: string; status: string }>(`/api/manufacturing/order-advance/${id}`, { method: 'POST', body: JSON.stringify({ to }) }),
  // Product picker source: inventory list (always enabled — manufacturing requires it).
  products: () => jsonFetch<{ items: ProductPick[] }>('/api/inventory/list'),
};

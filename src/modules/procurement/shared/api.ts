// Throw-on-error procurement API client. Mirrors inventory/products api.ts.
import type {
  ProductPick, PurchaseOrderDetail, PurchaseOrderItem, PurchaseOrderRow, Supplier, POAction,
} from './types';

export class ProcurementApiError extends Error {
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
    throw new ProcurementApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export interface NewSupplier { name: string; phone: string; email: string; notes: string }
export interface NewPOItem { product_id: string; qty: number; unit_cost_cents: number }
export interface NewPO { supplier_id: string; expected_on: string; notes: string; items: NewPOItem[] }

export const procurementApi = {
  // Suppliers
  listSuppliers: () => jsonFetch<{ suppliers: Supplier[] }>('/api/procurement/suppliers'),
  createSupplier: (b: NewSupplier) =>
    jsonFetch<{ supplier: Supplier }>('/api/procurement/suppliers', { method: 'POST', body: JSON.stringify(b) }),
  updateSupplier: (id: string, b: NewSupplier) =>
    jsonFetch<{ supplier: Supplier }>(`/api/procurement/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteSupplier: (id: string) =>
    jsonFetch<{ ok: true }>(`/api/procurement/suppliers/${id}`, { method: 'DELETE' }),

  // Purchase orders
  listOrders: () => jsonFetch<{ orders: PurchaseOrderRow[] }>('/api/procurement/orders'),
  getOrder: (id: string) =>
    jsonFetch<{ order: PurchaseOrderDetail; items: PurchaseOrderItem[] }>(`/api/procurement/orders/${id}`),
  createOrder: (b: NewPO) =>
    jsonFetch<{ id: string; status: string }>('/api/procurement/orders', { method: 'POST', body: JSON.stringify(b) }),
  transition: (id: string, action: POAction) =>
    jsonFetch<{ id: string; status: string }>(`/api/procurement/orders/${id}/transition`, {
      method: 'POST', body: JSON.stringify({ action }),
    }),

  // Product picker for the PO create form
  listProducts: () => jsonFetch<{ products: ProductPick[] }>('/api/procurement/products'),
};

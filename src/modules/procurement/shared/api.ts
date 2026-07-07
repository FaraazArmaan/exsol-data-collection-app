// Throw-on-error procurement API client. Mirrors inventory/products api.ts.
import type {
  ProductPick, PurchaseOrderDetail, PurchaseOrderItem, PurchaseOrderRow, Supplier, SupplierContact,
  SupplierPrice, PriceHistoryRow, ThreeWayMatch, SupplierInvoice, SpendData, POAction,
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

export interface NewSupplier {
  name: string; phone: string; email: string; notes: string;
  payment_terms: string; rating: number | null;
}
export interface NewContact { supplier_id: string; name: string; role: string; phone: string; email: string }
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

  // Supplier contacts
  listContacts: (supplierId: string) =>
    jsonFetch<{ contacts: SupplierContact[] }>(`/api/procurement/supplier-contacts?supplier_id=${supplierId}`),
  createContact: (b: NewContact) =>
    jsonFetch<{ contact: SupplierContact }>('/api/procurement/supplier-contacts', { method: 'POST', body: JSON.stringify(b) }),
  deleteContact: (id: string) =>
    jsonFetch<{ ok: true }>(`/api/procurement/supplier-contacts/${id}`, { method: 'DELETE' }),

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

  // Approval threshold settings
  getSettings: () => jsonFetch<{ po_approval_threshold_cents: number }>('/api/procurement/settings'),
  setSettings: (b: { po_approval_threshold_cents: number }) =>
    jsonFetch<{ po_approval_threshold_cents: number }>('/api/procurement/settings', { method: 'PATCH', body: JSON.stringify(b) }),

  // Price manager (per-supplier per-product, with history)
  listPrices: (supplierId: string) =>
    jsonFetch<{ prices: SupplierPrice[] }>(`/api/procurement/prices?supplier_id=${supplierId}`),
  priceHistory: (supplierId: string, productId: string) =>
    jsonFetch<{ history: PriceHistoryRow[] }>(`/api/procurement/prices?supplier_id=${supplierId}&product_id=${productId}`),
  setPrice: (b: { supplier_id: string; product_id: string; unit_cost_cents: number; effective_from?: string }) =>
    jsonFetch<{ ok: true; effective_from: string }>('/api/procurement/prices', { method: 'POST', body: JSON.stringify(b) }),

  // 3-way match (GRN + invoices → Finance expense)
  getMatch: (poId: string) =>
    jsonFetch<ThreeWayMatch>(`/api/procurement/match?purchase_order_id=${poId}`),
  confirmMatch: (poId: string) =>
    jsonFetch<{ ok: true; expense_id: string; amount_cents: number }>('/api/procurement/match', {
      method: 'POST', body: JSON.stringify({ purchase_order_id: poId }),
    }),
  createGrn: (b: { purchase_order_id: string; note?: string; items: { product_id: string; qty_received: number }[] }) =>
    jsonFetch<{ id: string }>('/api/procurement/grn', { method: 'POST', body: JSON.stringify(b) }),
  listInvoices: (poId: string) =>
    jsonFetch<{ invoices: SupplierInvoice[] }>(`/api/procurement/invoices?purchase_order_id=${poId}`),
  createInvoice: (b: { purchase_order_id: string; invoice_number: string; amount_cents: number }) =>
    jsonFetch<{ invoice: SupplierInvoice }>('/api/procurement/invoices', { method: 'POST', body: JSON.stringify(b) }),

  // Spend trend analytics
  spend: () => jsonFetch<SpendData>('/api/procurement/spend'),
};

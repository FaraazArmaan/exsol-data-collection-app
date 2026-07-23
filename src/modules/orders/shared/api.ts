// Throw-on-error Orders API client. Mirrors inventory/shared/api.ts: parse the
// body as text-then-safe-JSON, throw a typed error carrying the server's error
// code on any non-2xx so callers can surface it.
import type {
  OrdersDashboardData,
  OrdersQueueData,
  RefundRow,
  RefundAdvanceResult,
  ReturnCaseRow,
  ShipmentRow,
  PickupRow,
  BackorderRow,
  BackorderFulfillResult,
  SlaTarget,
  SlaData,
  FulfillmentRow,
  FulfillmentAdvanceResult,
  MergeGroupResult,
  SaleLinesResult,
} from './types';

export class OrdersApiError extends Error {
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
    throw new OrdersApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export const ordersApi = {
  dashboard: () =>
    jsonFetch<OrdersDashboardData>('/api/orders/dashboard'),

  listQueue: (filters: { q?: string; status?: string; channel?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);
    if (filters.channel) params.set('channel', filters.channel);
    const query = params.toString();
    return jsonFetch<OrdersQueueData>(`/api/orders/queue${query ? `?${query}` : ''}`);
  },

  // Refunds
  listRefunds: () =>
    jsonFetch<RefundRow[]>('/api/orders/refunds'),
  createRefund: (body: { sale_id: string; amount_cents: number; reason?: string }) =>
    jsonFetch<{ id: string; state: string }>('/api/orders/refunds', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  advanceRefund: (id: string, to: string) =>
    jsonFetch<RefundAdvanceResult>(`/api/orders/refund-advance/${id}`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),
  cancelRemaining: (saleId: string, saleLineIds: string[], reason?: string) =>
    jsonFetch<{ cancellation_id: string; refund_amount_cents: number }>(`/api/orders/cancel-remaining/${encodeURIComponent(saleId)}`, {
      method: 'POST', body: JSON.stringify({ sale_line_ids: saleLineIds, reason, idempotency_key: crypto.randomUUID() }),
    }),
  submitRefundToPayments: (id: string) =>
    jsonFetch<{ id: string; state: string; provider_pending: boolean }>(`/api/payments/orders-refunds/${encodeURIComponent(id)}/submit`, { method: 'POST' }),

  // Return cases — Orders owns authorisation and refund intent. Inventory and
  // Payments evidence is read as a projection, never edited from this surface.
  listReturnCases: () => jsonFetch<ReturnCaseRow[]>('/api/orders/returns'),
  advanceReturnCase: (id: string, to: 'authorized' | 'refused', reason?: string) =>
    jsonFetch<ReturnCaseRow>(`/api/orders/returns/${encodeURIComponent(id)}/advance`, {
      method: 'POST', body: JSON.stringify({ to, ...(reason ? { reason } : {}) }),
    }),
  requestReturnRefund: (caseId: string, returnLineId: string, reason?: string) =>
    jsonFetch<{ id: string; state: string; amount_cents: number }>(`/api/orders/returns/${encodeURIComponent(caseId)}/refund-request`, {
      method: 'POST', body: JSON.stringify({ return_line_id: returnLineId, ...(reason ? { reason } : {}) }),
    }),

  // Shipments
  listShipments: () =>
    jsonFetch<ShipmentRow[]>('/api/orders/shipments'),
  createShipment: (body: { sale_id: string; carrier?: string; tracking_ref?: string }) =>
    jsonFetch<ShipmentRow>('/api/orders/shipments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateShipment: (id: string, body: { carrier?: string; tracking_ref?: string; status?: string }) =>
    jsonFetch<ShipmentRow>(`/api/orders/shipment-detail/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...body, ...(body.status === 'shipped' || body.status === 'delivered' ? { idempotency_key: crypto.randomUUID() } : {}) }),
    }),

  listPickups: () => jsonFetch<PickupRow[]>('/api/orders/pickups'),
  markPickupReady: (saleId: string) => jsonFetch<PickupRow>('/api/orders/pickups', { method: 'POST', body: JSON.stringify({ sale_id: saleId, idempotency_key: crypto.randomUUID() }) }),
  collectPickup: (id: string, collectorName: string, phoneLast4: string) => jsonFetch<PickupRow>(`/api/orders/pickups/${encodeURIComponent(id)}/collect`, { method: 'POST', body: JSON.stringify({ collector_name: collectorName, collector_phone_last4: phoneLast4, idempotency_key: crypto.randomUUID() }) }),

  // Backorders
  listBackorders: () =>
    jsonFetch<BackorderRow[]>('/api/orders/backorders'),
  createBackorder: (body: { sale_id: string; product_id: string; qty_ordered: number }) =>
    jsonFetch<BackorderRow>('/api/orders/backorders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  fulfillBackorder: (id: string, qty: number) =>
    jsonFetch<BackorderFulfillResult>(`/api/orders/backorder-fulfill/${id}`, {
      method: 'POST',
      body: JSON.stringify({ qty }),
    }),

  // Pick-Pack PDF URLs — open these in a new tab via window.open or <a target="_blank">.
  pickListUrl: (saleId: string) => `/api/orders/pick-list/${saleId}`,
  packingSlipUrl: (saleId: string) => `/api/orders/packing-slip/${saleId}`,

  // SLA
  getSla: () =>
    jsonFetch<SlaData>('/api/orders/sla'),
  listSlaTargets: () =>
    jsonFetch<SlaTarget[]>('/api/orders/sla-targets'),
  updateSlaTargets: (targets: SlaTarget[]) =>
    jsonFetch<SlaTarget[]>('/api/orders/sla-targets', {
      method: 'PUT',
      body: JSON.stringify({ targets }),
    }),

  // Sale lines — canonical source for the split allocator.
  saleLines: (saleId: string) =>
    jsonFetch<SaleLinesResult>(`/api/orders/sale-lines/${encodeURIComponent(saleId)}`),

  // Fulfillments (split engine)
  listFulfillments: (saleId?: string) =>
    jsonFetch<FulfillmentRow[]>(
      saleId ? `/api/orders/fulfillments?sale_id=${encodeURIComponent(saleId)}` : '/api/orders/fulfillments',
    ),
  splitSale: (saleId: string, fulfillments: Array<{ label: string; lines: Array<{ sale_line_id: string; qty: number }> }>) =>
    jsonFetch<{ fulfillment_ids: string[] }>(`/api/orders/split/${encodeURIComponent(saleId)}`, {
      method: 'POST',
      body: JSON.stringify({ fulfillments }),
    }),
  advanceFulfillment: (id: string, to: string) =>
    jsonFetch<FulfillmentAdvanceResult>(`/api/orders/fulfillment-advance/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  // Merge
  mergeSales: (primarySaleId: string, saleIds: string[]) =>
    jsonFetch<MergeGroupResult>('/api/orders/merge', {
      method: 'POST',
      body: JSON.stringify({ primary_sale_id: primarySaleId, sale_ids: saleIds }),
    }),
};

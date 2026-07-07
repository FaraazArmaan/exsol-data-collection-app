// Throw-on-error Warehouse API client. Mirrors inventory/shared/api.ts: parse the
// body as text-then-safe-JSON, throw a typed error carrying the server's error
// code on any non-2xx so callers can surface it.
import type {
  AsnDetail, AsnStatus, AsnSummary, IncidentStatus, PutawayStatus, PutawayTask,
  SafetyChecklist, SafetyIncident, SlottingStatus, SlottingSuggestion,
  StockRow, TransferResult, WarehouseLocation, WarehouseProduct,
} from './types';

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

  // Putaway (feature: PO receipt → queue → confirm location)
  putawayList: (status: PutawayStatus | 'all' = 'pending') =>
    jsonFetch<{ tasks: PutawayTask[] }>(`/api/warehouse/putaway?status=${status}`),
  putawayGenerate: () =>
    jsonFetch<{ created: number }>('/api/warehouse/putaway-generate', { method: 'POST', body: '{}' }),
  putawayConfirm: (body: { task_id: string; location_id: string }) =>
    jsonFetch<{ task_id: string; location_id: string; qty: number }>('/api/warehouse/putaway-confirm', {
      method: 'POST', body: JSON.stringify(body),
    }),

  products: () => jsonFetch<{ products: WarehouseProduct[] }>('/api/warehouse/products'),

  // Inbound ASN (advance shipment notices; expected vs received)
  asnList: (status: AsnStatus | 'all' = 'all') =>
    jsonFetch<{ asns: AsnSummary[] }>(`/api/warehouse/asn?status=${status}`),
  asnCreate: (body: {
    reference: string; carrier?: string; eta?: string;
    purchase_order_id?: string; lines?: Array<{ product_id: string; expected_qty: number }>;
  }) => jsonFetch<{ asn: AsnSummary }>('/api/warehouse/asn', { method: 'POST', body: JSON.stringify(body) }),
  asnDetail: (id: string) => jsonFetch<AsnDetail>(`/api/warehouse/asn-detail/${id}`),
  asnReceive: (body: { asn_id: string; lines: Array<{ line_id: string; received_qty: number }> }) =>
    jsonFetch<{ asn_id: string; status: string }>('/api/warehouse/asn-receive', {
      method: 'POST', body: JSON.stringify(body),
    }),

  // Safety (incident log + recurring checklists)
  safetyIncidents: (status: IncidentStatus | 'all' = 'all') =>
    jsonFetch<{ incidents: SafetyIncident[] }>(`/api/warehouse/safety-incidents?status=${status}`),
  safetyIncidentCreate: (body: { title: string; severity: string; occurred_on?: string; description?: string; location_id?: string }) =>
    jsonFetch<{ incident: SafetyIncident }>('/api/warehouse/safety-incidents', { method: 'POST', body: JSON.stringify(body) }),
  safetyIncidentUpdate: (id: string, body: { status?: string; title?: string; description?: string }) =>
    jsonFetch<{ incident: SafetyIncident }>(`/api/warehouse/safety-incident/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  safetyIncidentDelete: (id: string) =>
    jsonFetch<null>(`/api/warehouse/safety-incident/${id}`, { method: 'DELETE' }),
  safetyChecklists: () =>
    jsonFetch<{ checklists: SafetyChecklist[] }>('/api/warehouse/safety-checklists'),
  safetyChecklistCreate: (body: { title: string; cadence: string }) =>
    jsonFetch<{ checklist: SafetyChecklist }>('/api/warehouse/safety-checklists', { method: 'POST', body: JSON.stringify(body) }),
  safetySignoff: (body: { checklist_id: string; notes?: string }) =>
    jsonFetch<{ signoff: { id: string; signed_at: string } }>('/api/warehouse/safety-signoff', { method: 'POST', body: JSON.stringify(body) }),

  // AI slotting (data-driven candidates + ai.ts rationale; human confirms)
  slottingList: (status: SlottingStatus | 'all' = 'pending') =>
    jsonFetch<{ suggestions: SlottingSuggestion[] }>(`/api/warehouse/ai-slotting?status=${status}`),
  slottingGenerate: () =>
    jsonFetch<{ created: number; ai_fallback: boolean }>('/api/warehouse/ai-slotting-generate', { method: 'POST', body: '{}' }),
  slottingDecide: (body: { suggestion_id: string; action: 'apply' | 'dismiss' }) =>
    jsonFetch<{ suggestion_id: string; status: string }>('/api/warehouse/ai-slotting-decide', {
      method: 'POST', body: JSON.stringify(body),
    }),
};

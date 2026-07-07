import type { BomCostRollup, BomListItem, BomDetail, CapacitySlot, ConsumptionLot, KanbanOrder, MaintLog, MfgResource, ProductCost, ProductionOrder, ProductPick, QcCheck, ScrapLog } from './types';

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

  // Kanban (drag board over the production-order FSM)
  kanban: () => jsonFetch<{ items: KanbanOrder[] }>('/api/manufacturing/kanban'),
  setOrderBoard: (body: { id: string; board_rank?: number; priority?: string; due_on?: string | null }) =>
    jsonFetch<{ order: { id: string; board_rank: number; priority: string; due_on: string | null } }>(
      '/api/manufacturing/order-board', { method: 'POST', body: JSON.stringify(body) },
    ),

  // BOM Designer cost rollup
  costs: () => jsonFetch<{ costs: ProductCost[] }>('/api/manufacturing/costs'),
  setCost: (body: { product_id: string; unit_cost_cents: number }) =>
    jsonFetch<{ product_id: string; unit_cost_cents: number }>('/api/manufacturing/costs', {
      method: 'POST', body: JSON.stringify(body),
    }),
  bomCost: (id: string) => jsonFetch<BomCostRollup>(`/api/manufacturing/bom-cost/${id}`),

  // Quality Control (per-order checklists; fail → scrap/rework)
  qcList: (orderId: string) => jsonFetch<{ checks: QcCheck[] }>(`/api/manufacturing/qc?order_id=${orderId}`),
  qcAdd: (body: { production_order_id: string; item: string }) =>
    jsonFetch<{ check: QcCheck }>('/api/manufacturing/qc', { method: 'POST', body: JSON.stringify(body) }),
  qcResult: (body: { id: string; result: string; disposition?: string; scrap_qty?: number; notes?: string }) =>
    jsonFetch<{ check: QcCheck }>('/api/manufacturing/qc-result', { method: 'POST', body: JSON.stringify(body) }),

  // Part Tracking (lot/batch traceability)
  lotsByOrder: (orderId: string) => jsonFetch<{ lots: ConsumptionLot[] }>(`/api/manufacturing/lots?order_id=${orderId}`),
  lotsByRef: (lotRef: string) => jsonFetch<{ lots: ConsumptionLot[] }>(`/api/manufacturing/lots?lot_ref=${encodeURIComponent(lotRef)}`),
  recordLot: (body: { production_order_id: string; component_product_id: string; lot_ref: string; qty: number }) =>
    jsonFetch<{ lot: ConsumptionLot }>('/api/manufacturing/lots', { method: 'POST', body: JSON.stringify(body) }),

  // Maintenance / Downtime / Scrap
  maintenance: (kind?: string) => jsonFetch<{ logs: MaintLog[] }>(`/api/manufacturing/maintenance${kind ? `?kind=${kind}` : ''}`),
  addMaintenance: (body: { kind: string; reason: string; minutes?: number; resource_label?: string; occurred_on?: string; notes?: string }) =>
    jsonFetch<{ log: MaintLog }>('/api/manufacturing/maintenance', { method: 'POST', body: JSON.stringify(body) }),
  scrapList: () => jsonFetch<{ logs: ScrapLog[] }>('/api/manufacturing/scrap'),
  scrap: (body: { product_id: string; qty: number; reason?: string }) =>
    jsonFetch<{ product_id: string; qty: number }>('/api/manufacturing/scrap', { method: 'POST', body: JSON.stringify(body) }),

  // Capacity Planning (resources vs booked hours)
  resources: () => jsonFetch<{ resources: MfgResource[] }>('/api/manufacturing/resources'),
  addResource: (body: { name: string; hours_per_day: number }) =>
    jsonFetch<{ resource: MfgResource }>('/api/manufacturing/resources', { method: 'POST', body: JSON.stringify(body) }),
  assignOrderResource: (body: { order_id: string; resource_id: string | null; estimated_hours: number }) =>
    jsonFetch<{ order_id: string }>('/api/manufacturing/order-resource', { method: 'POST', body: JSON.stringify(body) }),
  capacity: () => jsonFetch<{ resources: MfgResource[]; slots: CapacitySlot[] }>('/api/manufacturing/capacity'),
};

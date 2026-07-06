// CRM module FE API wrappers. Mirrors src/modules/booking/api.ts (throwing style).
// All endpoints are auth-gated (cookie credentials included).

export class CrmApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly details?: unknown) {
    super(code);
    this.name = 'CrmApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    let code = 'unknown';
    let details: unknown;
    try { const body = await res.json(); code = body?.error?.code ?? code; details = body?.error?.details; } catch { /* noop */ }
    throw new CrmApiError(res.status, code, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// ---------- Types ----------

export interface CrmCustomer {
  id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  source: 'pos' | 'storefront' | 'booking';
  first_seen: string;
  last_seen: string;
}

export interface CrmNote {
  id: string;
  body: string;
  created_by_user_node: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  kind: 'sale' | 'booking';
  id: string;
  when: string;
  label: string;
  amount_cents: number;
  status: string;
}

export interface CustomerDetail {
  customer: CrmCustomer;
  notes: CrmNote[];
  timeline: TimelineEvent[];
}

// ---------- API ----------

export const crmApi = {
  refresh: () => call<{ synced: number }>('/api/crm/refresh', { method: 'POST' }),
  listCustomers: (q = '') => call<{ customers: CrmCustomer[] }>(`/api/crm/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getCustomer: (id: string) => call<CustomerDetail>(`/api/crm/customers/${id}`),
  addNote: (customer_id: string, body: string) => call<{ note: CrmNote }>('/api/crm/notes', json('POST', { customer_id, body })),
  editNote: (id: string, body: string) => call<{ note: CrmNote }>(`/api/crm/notes/${id}`, json('PATCH', { body })),
  deleteNote: (id: string) => call<void>(`/api/crm/notes/${id}`, { method: 'DELETE' }),
};

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

// ---------- Unified communication timeline ----------

export type TimelineKind = 'sale' | 'booking' | 'note' | 'email' | 'campaign';

export interface StreamEvent {
  kind: TimelineKind;
  id: string;
  when: string;
  title: string;
  subtitle: string | null;
  amount_cents: number | null;
  status: string | null;
  editable: boolean;
}

export interface CustomerTimeline {
  customer: { id: string; display_name: string };
  events: StreamEvent[];
}

// ---------- Leads ----------

export type LeadStatus = 'new' | 'converted' | 'archived';

export interface CrmLead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  source: string;
  status: LeadStatus;
  converted_customer_id: string | null;
  created_at: string;
}

export interface LeadCounts { new: number; converted: number; archived: number; }

export interface LeadSubmitPayload {
  slug: string;
  name: string;
  email?: string;
  phone?: string;
  message?: string;
  honeypot?: string;
}

// ---------- Repeat cart (B2B reorder) ----------

export interface RepeatCartItem {
  product_id: string;
  name: string;
  unit_price_cents: number;
  qty: number;
  available: boolean;
  times_bought: number;
}

export interface RepeatCart {
  customer_name: string;
  items: RepeatCartItem[];
}

// ---------- Social sync (provider seam + mock) ----------

export type SocialProvider = 'google' | 'mailchimp' | 'facebook';

export interface SocialCard {
  provider: SocialProvider;
  label: string;
  status: 'connected' | 'disconnected';
  account_label: string | null;
  imported_total: number;
  last_imported_at: string | null;
}

// ---------- Customer dashboard (LTV / frequency / top) ----------

export interface CrmDashboardKpis {
  total_customers: number;
  active_customers: number;
  total_ltv_cents: number;
  avg_ltv_cents: number;
  avg_txns: number;
  repeat_rate: number; // percent
  new_last_30d: number;
}

export interface CrmTopCustomer {
  id: string;
  display_name: string;
  ltv_cents: number;
  txns: number;
  last_activity: string | null;
}

export interface CrmDashboard {
  kpis: CrmDashboardKpis;
  top_customers: CrmTopCustomer[];
}

// ---------- API ----------

export const crmApi = {
  refresh: () => call<{ synced: number }>('/api/crm/refresh', { method: 'POST' }),
  listCustomers: (q = '') => call<{ customers: CrmCustomer[] }>(`/api/crm/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getCustomer: (id: string) => call<CustomerDetail>(`/api/crm/customers/${id}`),
  timeline: (id: string) => call<CustomerTimeline>(`/api/crm/timeline/${id}`),
  addNote: (customer_id: string, body: string) => call<{ note: CrmNote }>('/api/crm/notes', json('POST', { customer_id, body })),
  editNote: (id: string, body: string) => call<{ note: CrmNote }>(`/api/crm/notes/${id}`, json('PATCH', { body })),
  deleteNote: (id: string) => call<void>(`/api/crm/notes/${id}`, { method: 'DELETE' }),
  dashboard: () => call<CrmDashboard>('/api/crm/dashboard'),

  listLeads: (status: LeadStatus = 'new') =>
    call<{ leads: CrmLead[]; counts: LeadCounts }>(`/api/crm/leads?status=${status}`),
  leadAction: (id: string, action: 'convert' | 'archive') =>
    call<{ id: string; status: LeadStatus; customer_id?: string }>(`/api/crm/lead-action/${id}`, json('POST', { action })),

  // Public — no session required (credentials are harmless on the public form).
  submitLead: (payload: LeadSubmitPayload) =>
    call<{ ok: boolean }>('/api/crm/lead-submit', json('POST', payload)),

  repeatCart: (id: string) => call<RepeatCart>(`/api/crm/repeat-cart/${id}`),

  listSocial: () => call<{ providers: SocialCard[] }>('/api/crm/social'),
  socialAction: (provider: SocialProvider, action: 'connect' | 'disconnect' | 'import') =>
    call<{ providers: SocialCard[]; imported?: number }>('/api/crm/social', json('POST', { provider, action })),
};

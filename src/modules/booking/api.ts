// Booking module FE API wrappers. Mirrors src/modules/pos/api.ts (throwing style).
// `bookingPublicApi` hits the anonymous /api/booking-public/:slug/* endpoints;
// `bookingApi` hits the auth-gated /api/booking/* endpoints (cookie included).

export class BookingApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly details?: unknown) {
    super(code);
    this.name = 'BookingApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    let code = 'unknown';
    let details: unknown;
    try { const body = await res.json(); code = body?.error?.code ?? code; details = body?.error?.details; } catch { /* noop */ }
    throw new BookingApiError(res.status, code, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// ---------- Types ----------
export type PaymentMode = 'pay_at_venue' | 'deposit' | 'full_upfront';
export interface PublicService {
  id: string; name: string; duration_min: number; price_cents: number;
  payment_mode: PaymentMode; deposit_cents: number | null;
}
export interface PublicResource { id: string; name: string; }
export interface Slot { start: string; end: string; resource_id: string; }
export interface CreateResult {
  booking_id: string; status: string; manage_token: string;
  payment_intent?: { provider: string; amount_cents: number; status: string };
}
export interface ManageView {
  id: string; status: string; start_at: string; end_at: string;
  customer_name: string; price_cents: number; cancellable: boolean;
  reschedulable: boolean; service_id: string; service_name: string; duration_min: number; slug: string;
}

// ---------- Vendor (authed) types ----------
export interface BookingSettings {
  slot_interval_min: number; lead_time_min: number; cancel_cutoff_min: number;
  weekly_schedule: Record<string, Array<{ open: string; close: string }>>;
  date_overrides: Array<{ date: string; closed?: boolean }>;
}
export interface VendorService {
  id: string; name: string; duration_min: number; price_cents: number;
  payment_mode: PaymentMode; deposit_cents: number | null; buffer_min: number;
  active: boolean; eligible_resource_ids: string[];
}
export interface VendorResource { id: string; name: string; weekly_schedule: Record<string, unknown>; active: boolean; }
export interface TimeOff { id: string; resource_id: string; starts_at: string; ends_at: string; reason: string | null; }
export interface VendorBooking {
  id: string; service_id: string | null; resource_id: string; user_node_id: string | null;
  start_at: string; end_at: string; status: string;
  customer_name: string | null; customer_phone: string | null; customer_email: string | null; price_cents: number;
}
export type BookingAction = 'cancel' | 'complete' | 'noShow' | 'unblock';

// ---------- Vendor (authed) ----------
export const bookingApi = {
  getSettings: () => call<BookingSettings>('/api/booking/settings'),
  putSettings: (body: BookingSettings) => call<BookingSettings>('/api/booking/settings', { ...json(body), method: 'PUT' }),

  listServices: () => call<{ services: VendorService[] }>('/api/booking/services'),
  createService: (body: Partial<VendorService>) => call<VendorService>('/api/booking/services', json(body)),
  patchService: (id: string, body: Partial<VendorService>) => call<VendorService>(`/api/booking/service-detail/${id}`, { ...json(body), method: 'PATCH' }),
  deleteService: (id: string) => call<{ id: string }>(`/api/booking/service-detail/${id}`, { method: 'DELETE' }),

  listResources: () => call<{ resources: VendorResource[] }>('/api/booking/resources'),
  createResource: (body: Partial<VendorResource>) => call<VendorResource>('/api/booking/resources', json(body)),
  patchResource: (id: string, body: Partial<VendorResource>) => call<VendorResource>(`/api/booking/resource-detail/${id}`, { ...json(body), method: 'PATCH' }),
  deleteResource: (id: string) => call<{ id: string }>(`/api/booking/resource-detail/${id}`, { method: 'DELETE' }),
  listTimeOff: (resourceId: string) => call<{ time_off: TimeOff[] }>(`/api/booking/resource-time-off?resource_id=${resourceId}`),
  addTimeOff: (body: { resource_id: string; starts_at: string; ends_at: string; reason?: string }) => call<TimeOff>('/api/booking/resource-time-off', json(body)),
  deleteTimeOff: (id: string) => call<{ id: string }>(`/api/booking/resource-time-off?id=${id}`, { method: 'DELETE' }),

  list: (query: string) => call<{ bookings: VendorBooking[] }>(`/api/booking/list${query ? '?' + query : ''}`),
  get: (id: string) => call<VendorBooking>(`/api/booking/detail/${id}`),
  transition: (id: string, action: BookingAction, reason?: string) => call<any>(`/api/booking/detail/${id}`, { ...json({ action, reason }), method: 'PATCH' }),
  reschedule: (id: string, start: string, resourceId?: string) => call<any>(`/api/booking/detail/${id}`, { ...json({ action: 'reschedule', start, resource_id: resourceId }), method: 'PATCH' }),
  manualCreate: (body: any) => call<{ id: string; status: string }>('/api/booking/manual-create', json(body)),
};

// ---------- Public (anonymous) ----------
export const bookingPublicApi = {
  tenant: (slug: string) => call<{ client: { id: string; slug: string; name: string } }>(`/api/u-client-by-slug?slug=${encodeURIComponent(slug)}`),
  services: (slug: string) => call<{ services: PublicService[] }>(`/api/booking-public/${slug}/services`),
  resources: (slug: string) => call<{ resources: PublicResource[] }>(`/api/booking-public/${slug}/resources`),
  availability: (slug: string, serviceId: string, date: string, resourceId = 'any') =>
    call<{ slots: Slot[] }>(`/api/booking-public/${slug}/availability?service_id=${serviceId}&date=${date}&resource_id=${resourceId}`),
  create: (slug: string, body: { service_id: string; resource_id: string; start: string; customer: { name: string; phone: string; email?: string }; hp?: string }) =>
    call<CreateResult>(`/api/booking-public/${slug}/create`, json(body)),
  getManage: (token: string) => call<ManageView>(`/api/booking-public/manage/${token}`),
  cancelManage: (token: string) => call<{ id: string; status: string }>(`/api/booking-public/manage/${token}`, json({ action: 'cancel' })),
  rescheduleManage: (token: string, start: string) => call<{ id: string; status: string; start_at: string; end_at: string }>(`/api/booking-public/manage/${token}`, json({ action: 'reschedule', start })),
};

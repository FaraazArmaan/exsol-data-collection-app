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
}

// ---------- Public (anonymous) ----------
export const bookingPublicApi = {
  services: (slug: string) => call<{ services: PublicService[] }>(`/api/booking-public/${slug}/services`),
  resources: (slug: string) => call<{ resources: PublicResource[] }>(`/api/booking-public/${slug}/resources`),
  availability: (slug: string, serviceId: string, date: string, resourceId = 'any') =>
    call<{ slots: Slot[] }>(`/api/booking-public/${slug}/availability?service_id=${serviceId}&date=${date}&resource_id=${resourceId}`),
  create: (slug: string, body: { service_id: string; resource_id: string; start: string; customer: { name: string; phone: string; email?: string } }) =>
    call<CreateResult>(`/api/booking-public/${slug}/create`, json(body)),
  getManage: (token: string) => call<ManageView>(`/api/booking-public/manage/${token}`),
  cancelManage: (token: string) => call<{ id: string; status: string }>(`/api/booking-public/manage/${token}`, json({ action: 'cancel' })),
};

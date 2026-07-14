// Booking module FE API wrappers. Mirrors src/modules/pos/api.ts (throwing style).
// `bookingPublicApi` hits the anonymous /api/booking-public/:slug/* endpoints;
// `bookingApi` hits the auth-gated /api/booking/* endpoints (cookie included).

export class BookingApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'BookingApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    let code = 'unknown';
    let details: unknown;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      details = body?.error?.details;
    } catch {
      /* noop */
    }
    throw new BookingApiError(res.status, code, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------- Types ----------
export type PaymentMode = 'pay_at_venue' | 'deposit' | 'full_upfront';
export interface PublicService {
  id: string;
  name: string;
  duration_min: number;
  price_cents: number;
  payment_mode: PaymentMode;
  deposit_cents: number | null;
}
export interface PublicResource {
  id: string;
  name: string;
}
export interface Slot {
  start: string;
  end: string;
  resource_id: string;
}
export interface CreateResult {
  booking_id: string;
  visit_id?: string;
  status: string;
  manage_token: string;
  payment_intent?: { provider: string; amount_cents: number; status: string };
}
export interface ManageView {
  id: string;
  status: string;
  start_at: string;
  end_at: string;
  customer_name: string;
  price_cents: number;
  cancellable: boolean;
  reschedulable: boolean;
  service_id: string;
  service_name: string;
  duration_min: number;
  slug: string;
  services?: PublicService[];
  policy?: {
    cancel_cutoff_min: number;
    reschedule_cutoff_min: number;
    max_customer_reschedules: number;
  };
  reschedule_count?: number;
}

// ---------- Vendor (authed) types ----------
export interface BookingSettings {
  slot_interval_min: number;
  lead_time_min: number;
  cancel_cutoff_min: number;
  weekly_schedule: Record<string, Array<{ open: string; close: string }>>;
  date_overrides: Array<{ date: string; closed?: boolean }>;
}
export interface BookingPolicy {
  version: number;
  cancel_cutoff_min: number;
  reschedule_cutoff_min: number;
  max_customer_reschedules: number;
  late_arrival_grace_min: number;
  no_show_outcome: 'staff_review' | 'automatic_no_show';
  cancellation_settlement: 'forfeit_deposit' | 'refund_deposit' | 'credit_deposit';
  late_reschedule_action: 'disallow' | 'staff_approval';
  late_reschedule_fee_cents: number;
  deposit_requirement: 'none' | 'service_defined' | 'required';
}
export type BookingPartyMode = 'specific_team_member' | 'any_team_member' | 'nobody_specific';
export type BookableKind = 'appointment' | 'space' | 'equipment';
export type ExtraCapacityNeed = 'space' | 'equipment';
export type AvailabilitySource = 'workforce' | 'manual';
export interface BookingSetup {
  booking_party_mode: BookingPartyMode;
  bookable_kinds: BookableKind[];
  extra_capacity_needs: ExtraCapacityNeed[];
  availability_source: AvailabilitySource;
  display_labels: { team: string; space: string; equipment: string };
  reservation_rules: {
    requires_team_member: boolean;
    allows_any_team_member: boolean;
    requires_space: boolean;
    requires_equipment: boolean;
    availability_source: AvailabilitySource;
  };
  visible_sections: Array<{ key: 'team' | 'space' | 'equipment' | 'rules'; label: string }>;
  completed_at: string | null;
  setup_version: number;
  is_first_visit: boolean;
}
export interface VendorService {
  id: string;
  name: string;
  duration_min: number;
  price_cents: number;
  payment_mode: PaymentMode;
  deposit_cents: number | null;
  buffer_min: number;
  active: boolean;
  eligible_resource_ids: string[];
}
export interface VendorResource {
  id: string;
  name: string;
  weekly_schedule: Record<string, unknown>;
  active: boolean;
}
export interface TimeOff {
  id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}
export interface VendorBooking {
  id: string;
  service_id: string | null;
  resource_id: string;
  user_node_id: string | null;
  start_at: string;
  end_at: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  price_cents: number;
  payment_status?: string;
  deposit_paid_cents?: number;
  events?: BookingEvent[];
}
export interface BookingEvent {
  id: string;
  source: string;
  event_type: string;
  previous_state: Record<string, unknown>;
  new_state: Record<string, unknown>;
  reason: string | null;
  reference: string | null;
  created_at: string;
}
export type BookingAction = 'cancel' | 'complete' | 'noShow' | 'unblock';

// ---------- Vendor (authed) ----------
export const bookingApi = {
  getSettings: () => call<BookingSettings>('/api/booking/settings'),
  putSettings: (body: BookingSettings) =>
    call<BookingSettings>('/api/booking/settings', { ...json(body), method: 'PUT' }),
  getPolicy: () => call<BookingPolicy>('/api/booking/policy'),
  putPolicy: (body: Omit<BookingPolicy, 'version'>) =>
    call<BookingPolicy>('/api/booking/policy', { ...json(body), method: 'PUT' }),
  getSetup: () => call<BookingSetup>('/api/booking/setup'),
  putSetup: (
    body: Pick<
      BookingSetup,
      'booking_party_mode' | 'bookable_kinds' | 'extra_capacity_needs' | 'availability_source'
    > & { display_labels?: Partial<BookingSetup['display_labels']> },
  ) => call<BookingSetup>('/api/booking/setup', { ...json(body), method: 'PUT' }),

  listServices: () => call<{ services: VendorService[] }>('/api/booking/services'),
  createService: (body: Partial<VendorService>) =>
    call<VendorService>('/api/booking/services', json(body)),
  patchService: (id: string, body: Partial<VendorService>) =>
    call<VendorService>(`/api/booking/service-detail/${id}`, { ...json(body), method: 'PATCH' }),
  deleteService: (id: string) =>
    call<{ id: string }>(`/api/booking/service-detail/${id}`, { method: 'DELETE' }),

  listResources: () => call<{ resources: VendorResource[] }>('/api/booking/resources'),
  createResource: (body: Partial<VendorResource>) =>
    call<VendorResource>('/api/booking/resources', json(body)),
  patchResource: (id: string, body: Partial<VendorResource>) =>
    call<VendorResource>(`/api/booking/resource-detail/${id}`, { ...json(body), method: 'PATCH' }),
  deleteResource: (id: string) =>
    call<{ id: string }>(`/api/booking/resource-detail/${id}`, { method: 'DELETE' }),
  listTimeOff: (resourceId: string) =>
    call<{ time_off: TimeOff[] }>(`/api/booking/resource-time-off?resource_id=${resourceId}`),
  addTimeOff: (body: {
    resource_id: string;
    starts_at: string;
    ends_at: string;
    reason?: string;
  }) => call<TimeOff>('/api/booking/resource-time-off', json(body)),
  deleteTimeOff: (id: string) =>
    call<{ id: string }>(`/api/booking/resource-time-off?id=${id}`, { method: 'DELETE' }),

  list: (query: string) =>
    call<{ bookings: VendorBooking[] }>(`/api/booking/list${query ? '?' + query : ''}`),
  get: (id: string) => call<VendorBooking>(`/api/booking/detail/${id}`),
  transition: (id: string, action: BookingAction, reason?: string) =>
    call<any>(`/api/booking/detail/${id}`, { ...json({ action, reason }), method: 'PATCH' }),
  reschedule: (id: string, start: string, resourceId?: string) =>
    call<any>(`/api/booking/detail/${id}`, {
      ...json({ action: 'reschedule', start, resource_id: resourceId }),
      method: 'PATCH',
    }),
  recordCash: (id: string, amountCents?: number, reference?: string) =>
    call<{ id: string; status: string; payment_status: string }>(`/api/booking/detail/${id}`, {
      ...json({ action: 'record_cash_payment', amount_cents: amountCents, reference }),
      method: 'PATCH',
    }),
  checkIn: (id: string) =>
    call<{ id: string; status: string; checked_in: boolean }>(`/api/booking/detail/${id}`, {
      ...json({ action: 'check_in' }),
      method: 'PATCH',
    }),
  manualCreate: (body: any) =>
    call<{ id: string; status: string }>('/api/booking/manual-create', json(body)),
};

// ---------- Public (anonymous) ----------
export const bookingPublicApi = {
  tenant: (slug: string) =>
    call<{ client: { id: string; slug: string; name: string } }>(
      `/api/u-client-by-slug?slug=${encodeURIComponent(slug)}`,
    ),
  services: (slug: string) =>
    call<{ services: PublicService[] }>(`/api/booking-public/${slug}/services`),
  resources: (slug: string) =>
    call<{ resources: PublicResource[] }>(`/api/booking-public/${slug}/resources`),
  availability: (slug: string, serviceIds: string[], date: string, resourceId = 'any') =>
    call<{ slots: Slot[] }>(
      `/api/booking-public/${slug}/availability?service_ids=${serviceIds.join(',')}&date=${date}&resource_id=${resourceId}`,
    ),
  create: (
    slug: string,
    body: {
      service_id?: string;
      service_ids?: string[];
      resource_id: string;
      start: string;
      customer: { name: string; phone: string; email?: string };
      hp?: string;
    },
  ) => call<CreateResult>(`/api/booking-public/${slug}/create`, json(body)),
  getManage: (token: string) => call<ManageView>(`/api/booking-public/manage/${token}`),
  cancelManage: (token: string) =>
    call<{ id: string; status: string }>(
      `/api/booking-public/manage/${token}`,
      json({ action: 'cancel' }),
    ),
  rescheduleManage: (token: string, start: string) =>
    call<{ id: string; status: string; start_at: string; end_at: string }>(
      `/api/booking-public/manage/${token}`,
      json({ action: 'reschedule', start }),
    ),
};

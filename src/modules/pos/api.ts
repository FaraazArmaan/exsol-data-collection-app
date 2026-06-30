//
// Typed fetch wrappers for /api/pos/*. Throws PosApiError on non-2xx.
// FE pages catch the error and display the `code` (FSM action gates,
// validation failures, 4xx auth gates all surface here).

export class PosApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'PosApiError';
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
    } catch { /* malformed body — keep defaults */ }
    throw new PosApiError(res.status, code, details);
  }
  // Tolerate 204 / empty body
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Response shapes ─────────────────────────────────────────────────────────

export interface MenuResponse {
  categories: { id: string; name: string; productCount: number }[];
  products:   {
    id: string; name: string; categoryId: string | null;
    salePriceCents: number; thumbKey: string | null;
  }[];
}

export interface SaleCreateInput {
  channel: 'instore' | 'online' | 'pickup';
  idempotencyKey: string;
  customer: { name: string; phone: string; email?: string };
  lines: { productId: string; qty: number }[];
}

export type FsmAction = 'markPaid' | 'fulfill' | 'cancel' | 'refund';
export interface TransitionInput {
  action: FsmAction;
  paymentMethod?: 'cash';
  reason?: string;
}

// ── Wrappers ────────────────────────────────────────────────────────────────

// ── Public storefront (unauthenticated) ─────────────────────────────────────

export interface PublicMenuResponse {
  tenant: { name: string };
  categories: { id: string; name: string; productCount: number }[];
  products: { id: string; name: string; categoryId: string | null; salePriceCents: number; thumbKey: string | null }[];
}

export interface PublicSaleInput {
  slug: string;
  channel: 'online' | 'pickup';
  idempotencyKey: string;
  honeypot: string;
  customer: { name: string; phone: string; email?: string };
  lines: { productId: string; qty: number }[];
}

export const publicApi = {
  getMenu: (slug: string) => call<PublicMenuResponse>(`/api/public/menu/${slug}`),

  createSale: (body: PublicSaleInput) =>
    call<any>('/api/public/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getSale: (saleUuid: string) => call<any>(`/api/public/sales/${saleUuid}`),
};

export const posApi = {
  getMenu: () => call<MenuResponse>('/api/pos/menu'),

  createSale: (body: SaleCreateInput) =>
    call<any>('/api/pos/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getSales: (query: string) =>
    call<any>(`/api/pos/sales${query ? '?' + query : ''}`),

  getSale: (id: string) =>
    call<any>(`/api/pos/sales/${id}`),

  transition: (id: string, body: TransitionInput) =>
    call<any>(`/api/pos/sales/${id}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

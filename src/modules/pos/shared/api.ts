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

export interface MenuProductDto {
  id: string; name: string; categoryId: string | null;
  salePriceCents: number; thumbKey: string | null;
  isBundle?: boolean;
  bundleInStock?: boolean;
  bundleComponents?: { name: string; qty: number }[];
}

export interface MenuResponse {
  categories: { id: string; name: string; productCount: number }[];
  products: MenuProductDto[];
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

export interface CmsHero {
  enabled: boolean;
  heading: string;
  subheading?: string;
  ctaLabel?: string;
  ctaHref?: string;
}
export interface StorefrontSections {
  hero?: CmsHero;
  banners?: { text: string }[];
}

export interface PublicMenuResponse {
  tenant: { name: string };
  cms?: StorefrontSections;
  categories: { id: string; name: string; productCount: number }[];
  products: MenuProductDto[];
}

export interface PublicSaleInput {
  slug: string;
  channel: 'online' | 'pickup';
  idempotencyKey: string;
  honeypot: string;
  customer: { name: string; phone: string; email?: string };
  lines: { productId: string; qty: number }[];
  couponCode?: string;
}

export interface RazorpayPaymentIntent {
  provider: 'razorpay';
  status: 'created';
  amount_cents: number;
  currency: 'INR';
  order_id: string;
  key_id: string;
  expires_at: string;
}

export interface SaleCheckoutResponse {
  id: string;
  totalCents?: number;
  total_cents?: number | string;
  payment_intent?: RazorpayPaymentIntent;
}

export type CouponPreview =
  | { valid: true; code: string; discountCents: number }
  | { valid: false; reason: string };

export const publicApi = {
  getMenu: (slug: string) => call<PublicMenuResponse>(`/api/public/menu/${slug}`),

  validateCoupon: (slug: string, code: string, subtotalCents: number) =>
    call<CouponPreview>('/api/public/coupon-validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, code, subtotalCents }),
    }),

  createSale: (body: PublicSaleInput) =>
    call<SaleCheckoutResponse>('/api/public/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getSale: (saleUuid: string) => call<any>(`/api/public/sales/${saleUuid}`),

  saveCart: (body: {
    slug: string; sessionKey: string; channel?: 'online' | 'pickup';
    customer: { name?: string; email: string };
    lines: { productId: string; qty: number }[];
  }) =>
    call<{ ok: boolean; stored: boolean }>('/api/public/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getConfig: (slug: string) => call<StorefrontConfig>(`/api/public/config/${slug}`),

  getReviews: (slug: string, productId?: string) =>
    call<PublicReviews>(`/api/public/reviews/${slug}${productId ? `?productId=${productId}` : ''}`),

  submitReview: (body: ReviewSubmit) =>
    call<{ id: string; status: string }>('/api/public/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

export interface ReviewSubmit {
  slug: string;
  honeypot: string;
  productId?: string;
  kind: 'review' | 'question';
  rating?: number;
  authorName: string;
  authorEmail?: string;
  body: string;
}

export interface PublicReview {
  id: string;
  rating: number | null;
  authorName: string;
  body: string;
  answer: string | null;
  productId: string | null;
  productName: string | null;
  createdAt: string;
}

export interface PublicReviews {
  summary: { avgRating: number | null; reviewCount: number };
  reviews: PublicReview[];
  questions: PublicReview[];
}

export interface StorefrontTax {
  enabled: boolean;
  rateBps: number;
  label: string;
  inclusive: boolean;
}

export interface StorefrontConfig {
  currency: string;
  tax: StorefrontTax;
}

export const posApi = {
  getMenu: () => call<MenuResponse>('/api/pos/menu'),

  createSale: (body: SaleCreateInput) =>
    call<SaleCheckoutResponse>('/api/pos/sales', {
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

  listCoupons: () => call<{ coupons: Coupon[] }>('/api/pos/coupons'),

  createCoupon: (body: CouponCreateInput) =>
    call<{ coupon: Coupon }>('/api/pos/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  patchCoupon: (id: string, body: Partial<Pick<Coupon, 'active' | 'minOrderCents' | 'maxRedemptions' | 'perCustomerLimit' | 'expiresAt'>>) =>
    call<{ id: string }>(`/api/pos/coupons/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteCoupon: (id: string) => call<{ id: string }>(`/api/pos/coupons/${id}`, { method: 'DELETE' }),

  listReviews: (status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    call<{ reviews: StaffReview[] }>(`/api/pos/reviews?status=${status}`),

  moderateReview: (id: string, body: { status?: 'approved' | 'rejected'; answer?: string | null }) =>
    call<{ id: string }>(`/api/pos/reviews/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  listBundles: () => call<{ bundles: Bundle[] }>('/api/pos/bundles'),

  createBundle: (body: BundleCreateInput) =>
    call<{ id: string }>('/api/pos/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  deleteBundle: (id: string) => call<{ id: string }>(`/api/pos/bundles/${id}`, { method: 'DELETE' }),

  getTax: () => call<{ tax: StorefrontTax }>('/api/pos/tax'),

  putTax: (body: StorefrontTax) =>
    call<{ ok: boolean }>('/api/pos/tax', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getCms: () => call<{ sections: StorefrontSections; published: boolean }>('/api/pos/storefront-cms'),

  putCms: (body: { sections: StorefrontSections; published: boolean }) =>
    call<{ ok: boolean }>('/api/pos/storefront-cms', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

export interface Bundle {
  id: string;
  name: string;
  priceCents: number;
  storefrontVisible: boolean;
  inStock: boolean;
  components: { productId: string; name: string; qty: number }[];
}

export interface BundleCreateInput {
  name: string;
  priceCents: number;
  storefrontVisible?: boolean;
  components: { productId: string; qty: number }[];
}

export interface StaffReview {
  id: string;
  kind: 'review' | 'question';
  rating: number | null;
  authorName: string;
  authorEmail: string | null;
  body: string;
  answer: string | null;
  status: 'pending' | 'approved' | 'rejected';
  productId: string | null;
  productName: string | null;
  createdAt: string;
  moderatedAt: string | null;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minOrderCents: number;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  redeemedCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface CouponCreateInput {
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  minOrderCents?: number;
  maxRedemptions?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  active?: boolean;
}

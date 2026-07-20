// Throw-on-error API client for the workspace Product Manager. Mirrors the
// pattern in `src/modules/files/shared/api.ts` so the existing apiFetch
// (Result<T>) shape is bypassed for cleaner consumer code in components that
// optimistically refetch on success.

import type {
  Product, ProductWithImages, ProductCategory, ProductListResponse,
  ProductFilters, ProductVariant, BulkAction, BulkResult, ImportDryRun,
} from './types';

export interface ScopeOpts {
  clientId?: string;
}

function withScope(url: string, opts?: ScopeOpts): string {
  if (!opts?.clientId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}client=${encodeURIComponent(opts.clientId)}`;
}

export class ProductsApiError extends Error {
  constructor(public status: number, public code: string, public detail: unknown) {
    super(`${code} (${status})`);
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
    throw new ProductsApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

async function formFetch<T>(url: string, fd: FormData): Promise<T> {
  // Don't set Content-Type — the browser writes the multipart boundary.
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: fd });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code?: string } } | null)?.error;
    throw new ProductsApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

function qs(f: ProductFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status !== 'all') p.set('status', f.status);
  if (f.type)        p.set('type', f.type);
  if (f.category_id) p.set('category_id', f.category_id);
  if (f.brand)       p.set('brand', f.brand);
  if (f.q)           p.set('q', f.q);
  if (f.tags)        for (const t of f.tags) p.append('tag', t);
  if (f.page)        p.set('page', String(f.page));
  if (f.page_size)   p.set('page_size', String(f.page_size));
  if (f.sort)        p.set('sort', f.sort);
  if (f.order)       p.set('order', f.order);
  return p.toString();
}

// ─── Products ────────────────────────────────────────────────────────────────

export const productsApi = {
  list: (f: ProductFilters, opts?: ScopeOpts): Promise<ProductListResponse> => {
    const q = qs(f);
    return jsonFetch(withScope(`/api/u-products${q ? `?${q}` : ''}`, opts));
  },
  get: (id: string, opts?: ScopeOpts): Promise<ProductWithImages> =>
    jsonFetch(withScope(`/api/u-products-detail/${id}`, opts)),
  create: (body: Partial<Product>, opts?: ScopeOpts): Promise<Product> =>
    jsonFetch(withScope('/api/u-products', opts), { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Product> & { expected_updated_at?: string }, opts?: ScopeOpts): Promise<Product> =>
    jsonFetch(withScope(`/api/u-products-detail/${id}`, opts), { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string, opts?: ScopeOpts): Promise<void> =>
    jsonFetch<void>(withScope(`/api/u-products-detail/${id}`, opts), { method: 'DELETE' }),
  bulk: (body: BulkAction, opts?: ScopeOpts): Promise<BulkResult> =>
    jsonFetch(withScope('/api/u-products-bulk', opts), { method: 'POST', body: JSON.stringify(body) }),
  exportUrl: (
    f: ProductFilters,
    format: 'csv' | 'xlsx' | 'meta' | 'whatsapp' | 'amazon' | 'flipkart',
    opts?: ScopeOpts,
  ): string => {
    const q = qs(f);
    const sep = q ? '&' : '';
    return withScope(`/api/u-products-export?${q}${sep}format=${format}`, opts);
  },
  importDryRun: (file: File, opts?: ScopeOpts): Promise<ImportDryRun> => {
    const fd = new FormData();
    fd.append('file', file);
    return formFetch(withScope(`/api/u-products-import?dry_run=true`, opts), fd);
  },
  importCommit: (file: File, opts?: ScopeOpts): Promise<ImportDryRun & { committed: true }> => {
    const fd = new FormData();
    fd.append('file', file);
    return formFetch(withScope('/api/u-products-import', opts), fd);
  },
};

// ─── Variants ────────────────────────────────────────────────────────────────

export const variantsApi = {
  list: (productId: string, opts?: ScopeOpts): Promise<{ items: ProductVariant[] }> =>
    jsonFetch(withScope(`/api/u-product-variants?product_id=${encodeURIComponent(productId)}`, opts)),
  create: (body: Partial<ProductVariant> & { product_id: string; title: string }, opts?: ScopeOpts): Promise<ProductVariant> =>
    jsonFetch(withScope('/api/u-product-variants', opts), { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<ProductVariant> & { expected_updated_at?: string }, opts?: ScopeOpts): Promise<ProductVariant> =>
    jsonFetch(withScope(`/api/u-product-variants/${id}`, opts), { method: 'PATCH', body: JSON.stringify(body) }),
};

// ─── Categories ──────────────────────────────────────────────────────────────

export const categoriesApi = {
  list: (opts?: ScopeOpts): Promise<{ items: ProductCategory[] }> =>
    jsonFetch(withScope('/api/u-product-categories', opts)),
  create: (name: string, opts?: ScopeOpts): Promise<ProductCategory> =>
    jsonFetch(withScope('/api/u-product-categories', opts), { method: 'POST', body: JSON.stringify({ name }) }),
  update: (id: string, body: { name?: string; sort_order?: number }, opts?: ScopeOpts): Promise<ProductCategory> =>
    jsonFetch(withScope(`/api/u-product-categories/${id}`, opts), { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string, opts?: ScopeOpts): Promise<void> =>
    jsonFetch<void>(withScope(`/api/u-product-categories/${id}`, opts), { method: 'DELETE' }),
};

// ─── Images ──────────────────────────────────────────────────────────────────
// Single-step multipart upload (the server has u-products-image POST with
// product_id + file, NOT a separate reserve/PUT/register triad).

export interface ProductImageRow {
  id: string;
  product_id: string;
  blob_key: string;
  sort_order: number;
}

export const imagesApi = {
  upload: (product_id: string, file: File, sort_order?: number, opts?: ScopeOpts): Promise<ProductImageRow> => {
    const fd = new FormData();
    fd.append('product_id', product_id);
    if (sort_order != null) fd.append('sort_order', String(sort_order));
    fd.append('file', file);
    return formFetch(withScope('/api/u-products-image', opts), fd);
  },
  remove: (image_id: string, opts?: ScopeOpts): Promise<void> =>
    jsonFetch<void>(withScope(`/api/u-products-image/${image_id}`, opts), { method: 'DELETE' }),
  thumbUrl: (image_id: string, opts?: ScopeOpts): string =>
    withScope(`/api/u-products-image-thumb/${image_id}`, opts),
};

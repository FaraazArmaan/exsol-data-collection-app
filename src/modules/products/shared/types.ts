export type ProductType   = 'physical' | 'service';
export type ProductStatus = 'active' | 'draft' | 'archived';

export interface ProductImage {
  id: string;
  blob_key: string;
  sort_order: number;
}

export interface Product {
  id: string;
  type: ProductType;
  name: string;
  description: string | null;
  category_id: string | null;
  brand: string | null;
  tags: string[];
  price_cents: number;
  currency: string;
  sku: string | null;
  stock_qty: number | null;
  unit: string | null;
  status: ProductStatus;
  hero_image_key: string | null;
  hero_image_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductWithImages extends Product {
  images: ProductImage[];
}

export interface ProductCategory {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProductListResponse {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
  counts: { all: number; active: number; draft: number; archived: number };
}

export interface ProductFilters {
  status?: ProductStatus | 'all';
  type?: ProductType;
  category_id?: string;
  brand?: string;
  q?: string;
  tags?: string[];
  page?: number;
  page_size?: number;
  sort?: 'created_at' | 'name' | 'price_cents';
  order?: 'asc' | 'desc';
}

export type BulkAction =
  | { ids: string[]; action: 'set_status';   value: ProductStatus }
  | { ids: string[]; action: 'set_category'; category_id: string | null }
  | { ids: string[]; action: 'delete' };

export interface BulkResult {
  ok: string[];
  errors: { id: string; code: string }[];
}

export interface ImportSummary {
  to_create: number;
  to_update: number;
  errors: number;
  warnings: number;
}

export interface ImportDryRun {
  valid: Array<{ row: number; name: string; action: 'create' | 'update'; id?: string }>;
  errors: Array<{ row: number; field: string; message: string }>;
  warnings: Array<{ row: number; message: string }>;
  summary: ImportSummary;
  committed?: boolean;
}

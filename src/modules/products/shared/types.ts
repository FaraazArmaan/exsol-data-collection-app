export type ProductType   = 'physical' | 'service';
export type ProductStatus = 'active' | 'draft' | 'archived';
export type Condition    = 'new' | 'refurbished' | 'used';
export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued';

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
  // Inventory is the operational source of truth. `stock_qty` remains only
  // for legacy API/import compatibility during the staged transition.
  inventory_qty_on_hand: number | null;
  inventory_qty_reserved: number | null;
  inventory_qty_available: number | null;
  inventory_enabled?: boolean;
  unit: string | null;
  status: ProductStatus;
  hero_image_key: string | null;
  hero_image_id: string | null;
  created_at: string;
  updated_at: string;

  // Phase B
  gtin: string | null;
  mpn: string | null;
  condition: Condition;
  availability: Availability;
  sale_price_cents: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  weight_grams: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  color: string | null;
  size: string | null;
  material: string | null;
  gender: string | null;
  age_group: string | null;
  manufacturer: string | null;
  country_of_origin: string | null;
  hsn_code: string | null;
  discount_percent: number | null;
  gst_rate: number | null;
  google_category: string | null;
  meta_category: string | null;
  product_url: string | null;
  platform_extras: Record<string, unknown>;
}

export interface ProductWithImages extends Product {
  images: ProductImage[];
}

// A variant keeps product marketing content while owning the fields a scanner,
// stock ledger, and receipt must distinguish.
export interface ProductVariant {
  id: string;
  client_id: string;
  product_id: string;
  title: string;
  option_values: Record<string, unknown>;
  sku: string | null;
  barcode: string | null;
  price_cents: number | null;
  sale_price_cents: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  status: ProductStatus;
  availability: Availability;
  pos_visible: boolean;
  storefront_visible: boolean;
  created_at: string;
  updated_at: string;
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
  inventory_enabled: boolean;
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

import type { ProductImage } from '../../../../src/modules/products/shared/types';

export interface ExportProductRow {
  id: string;
  type: 'physical' | 'service';
  name: string;
  description: string | null;
  category_name: string | null;       // joined at fetch time
  brand: string | null;
  tags: string[];
  price_cents: number;
  currency: string;
  sku: string | null;
  stock_qty: number | null;
  unit: string | null;
  status: 'active' | 'draft' | 'archived';
  hero_image_key: string | null;
  gtin: string | null;
  mpn: string | null;
  condition: 'new' | 'refurbished' | 'used';
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued';
  discount_percent: number | null;
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
  gst_rate: number | null;
  google_category: string | null;
  meta_category: string | null;
  product_url: string | null;
  platform_extras: Record<string, unknown>;
  images: ProductImage[];             // ordered, hero first
}

export interface ExporterContext {
  rows: ExportProductRow[];
  clientSlug: string;
  generatedAt: Date;
}

export interface ExportResult {
  /** Inner file name (e.g., 'products.csv'). Wrapped in ZIP later. */
  filename: string;
  contentType: string;
  body: string | Buffer;
  /** Human-readable name for README / ZIP filename. */
  platformLabel: string;
}

export class ExportTooLargeError extends Error {
  constructor(public sizeBytes: number, public limit: number) {
    super(`export_too_large: ${sizeBytes} bytes > ${limit} byte limit`);
  }
}

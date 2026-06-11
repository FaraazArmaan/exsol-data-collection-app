export type ProductType   = 'physical' | 'service';
export type ProductStatus = 'active' | 'draft' | 'archived';
export type Condition    = 'new' | 'refurbished' | 'used';
export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'discontinued';

export interface FieldError { field: string; message: string; }

export interface CreateProductInput {
  type: ProductType;
  name: string;
  description?: string | null;
  category_id?: string | null;
  brand?: string | null;
  tags?: string[];
  price_cents: number;
  sku?: string | null;
  stock_qty?: number | null;
  unit?: string | null;
  status?: ProductStatus;

  // Phase B platform fields
  gtin?: string | null;
  mpn?: string | null;
  condition?: Condition;
  availability?: Availability;
  sale_price_cents?: number | null;
  sale_starts_at?: string | null;     // ISO timestamp
  sale_ends_at?: string | null;
  discount_percent?: number | null;
  weight_grams?: number | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  color?: string | null;
  size?: string | null;
  material?: string | null;
  gender?: string | null;
  age_group?: string | null;
  manufacturer?: string | null;
  country_of_origin?: string | null;
  hsn_code?: string | null;
  gst_rate?: number | null;
  google_category?: string | null;
  meta_category?: string | null;
  product_url?: string | null;
  platform_extras?: Record<string, unknown>;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isType(v: unknown): v is ProductType { return v === 'physical' || v === 'service'; }
function isStatus(v: unknown): v is ProductStatus { return v === 'active' || v === 'draft' || v === 'archived'; }
function isCondition(v: unknown): v is Condition {
  return v === 'new' || v === 'refurbished' || v === 'used';
}
function isAvailability(v: unknown): v is Availability {
  return v === 'in_stock' || v === 'out_of_stock' || v === 'preorder' || v === 'discontinued';
}

export function validateTypeFields(p: { type: ProductType; sku?: unknown; stock_qty?: unknown; unit?: unknown }): FieldError[] {
  if (p.type === 'service') {
    const errs: FieldError[] = [];
    if (p.sku       != null && p.sku       !== '') errs.push({ field: 'sku',       message: 'services cannot have sku' });
    if (p.stock_qty != null)                       errs.push({ field: 'stock_qty', message: 'services cannot have stock_qty' });
    if (p.unit      != null && p.unit      !== '') errs.push({ field: 'unit',      message: 'services cannot have unit' });
    return errs;
  }
  return [];
}

export function parseCreateProduct(input: unknown): ParseResult<CreateProductInput> {
  const errors: FieldError[] = [];
  const v = (input ?? {}) as Record<string, unknown>;

  if (!isType(v.type)) errors.push({ field: 'type', message: 'must be physical|service' });
  if (typeof v.name !== 'string' || v.name.length === 0 || v.name.length > 120) {
    errors.push({ field: 'name', message: 'required, 1..120 chars' });
  }
  if (typeof v.price_cents !== 'number' || !Number.isInteger(v.price_cents) || v.price_cents < 0) {
    errors.push({ field: 'price_cents', message: 'integer >= 0' });
  }
  if (v.category_id != null && (typeof v.category_id !== 'string' || !UUID_RE.test(v.category_id))) {
    errors.push({ field: 'category_id', message: 'must be uuid' });
  }
  if (v.status != null && !isStatus(v.status)) errors.push({ field: 'status', message: 'must be active|draft|archived' });
  if (v.tags != null && (!Array.isArray(v.tags) || !v.tags.every((t) => typeof t === 'string'))) {
    errors.push({ field: 'tags', message: 'must be string[]' });
  }
  if (v.stock_qty != null && (typeof v.stock_qty !== 'number' || !Number.isInteger(v.stock_qty) || v.stock_qty < 0)) {
    errors.push({ field: 'stock_qty', message: 'integer >= 0 or null' });
  }
  if (v.condition != null && !isCondition(v.condition))
    errors.push({ field: 'condition', message: 'must be new|refurbished|used' });
  if (v.availability != null && !isAvailability(v.availability))
    errors.push({ field: 'availability', message: 'must be in_stock|out_of_stock|preorder|discontinued' });
  if (v.sale_price_cents != null && (typeof v.sale_price_cents !== 'number' || !Number.isInteger(v.sale_price_cents) || v.sale_price_cents < 0))
    errors.push({ field: 'sale_price_cents', message: 'integer >= 0 or null' });
  for (const dim of ['weight_grams','length_mm','width_mm','height_mm'] as const) {
    if (v[dim] != null && (typeof v[dim] !== 'number' || !Number.isInteger(v[dim]) || (v[dim] as number) < 0))
      errors.push({ field: dim, message: 'integer >= 0 or null' });
  }
  if (v.gst_rate != null && (typeof v.gst_rate !== 'number' || v.gst_rate < 0 || v.gst_rate > 100))
    errors.push({ field: 'gst_rate', message: 'number 0-100 or null' });
  if (v.discount_percent != null && (
    typeof v.discount_percent !== 'number' ||
    v.discount_percent <= 0 ||
    v.discount_percent >= 100
  )) {
    errors.push({ field: 'discount_percent', message: 'must be > 0 and < 100 or null' });
  }
  if (v.platform_extras != null && (typeof v.platform_extras !== 'object' || Array.isArray(v.platform_extras)))
    errors.push({ field: 'platform_extras', message: 'must be object or null' });
  if (errors.length === 0 && isType(v.type)) {
    errors.push(...validateTypeFields({
      type: v.type, sku: v.sku, stock_qty: v.stock_qty, unit: v.unit,
    }));
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: v as unknown as CreateProductInput };
}

export type PatchProductInput = Partial<CreateProductInput>;

export function parsePatchProduct(input: unknown): ParseResult<PatchProductInput> {
  const v = (input ?? {}) as Record<string, unknown>;
  if (Object.keys(v).length === 0) return { ok: false, errors: [{ field: '_root', message: 'empty patch' }] };
  const ALLOWED = [
    'type','name','description','category_id','brand','tags',
    'price_cents','sku','stock_qty','unit','status','hero_image_key',
    // Phase B
    'gtin','mpn','condition','availability',
    'sale_price_cents','sale_starts_at','sale_ends_at','discount_percent',
    'weight_grams','length_mm','width_mm','height_mm',
    'color','size','material','gender','age_group',
    'manufacturer','country_of_origin','hsn_code','gst_rate',
    'google_category','meta_category','product_url','platform_extras',
  ];
  const errors: FieldError[] = [];
  for (const k of Object.keys(v)) {
    if (!ALLOWED.includes(k)) errors.push({ field: k, message: 'unknown field' });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: v as PatchProductInput };
}

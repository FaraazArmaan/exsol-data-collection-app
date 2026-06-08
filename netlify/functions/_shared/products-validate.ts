export type ProductType   = 'physical' | 'service';
export type ProductStatus = 'active' | 'draft' | 'archived';

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
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isType(v: unknown): v is ProductType { return v === 'physical' || v === 'service'; }
function isStatus(v: unknown): v is ProductStatus { return v === 'active' || v === 'draft' || v === 'archived'; }

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
  const ALLOWED = ['type','name','description','category_id','brand','tags','price_cents','sku','stock_qty','unit','status','hero_image_key'];
  const errors: FieldError[] = [];
  for (const k of Object.keys(v)) {
    if (!ALLOWED.includes(k)) errors.push({ field: k, message: 'unknown field' });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: v as PatchProductInput };
}

// CSV/XLSX byte-buffer → typed product rows with per-row error lists.
// Used by u-products-import for both the dry-run preview and the commit pass.

import * as XLSX from 'xlsx';
import { validateTypeFields, type FieldError } from './products-validate';
import type { Condition, Availability } from './products-validate';

export const PHASE_B_HEADERS = [
  'gtin', 'mpn', 'condition', 'availability',
  'sale_price', 'sale_starts_at', 'sale_ends_at',
  'weight_grams', 'length_mm', 'width_mm', 'height_mm',
  'color', 'size', 'material', 'gender', 'age_group',
  'manufacturer', 'country_of_origin', 'hsn_code', 'gst_rate',
  'google_category', 'meta_category', 'product_url',
] as const;
export type PhaseBHeader = typeof PHASE_B_HEADERS[number];

export interface ParsedImportRow {
  row_index: number;             // 1-based, including header row (so first data row = 2)
  sku: string | null;
  name: string;
  type: 'physical' | 'service';
  category_name: string | null;
  brand: string | null;
  price_cents: number;
  currency: string;
  stock_qty: number | null;
  unit: string | null;
  status: 'active' | 'draft' | 'archived';
  tags: string[];
  description: string | null;

  // Phase B
  gtin: string | null;
  mpn: string | null;
  condition: Condition | null;
  availability: Availability | null;
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

  errors: FieldError[];
}

export interface ParsedImport {
  rows: ParsedImportRow[];
  meta: { total: number; valid: number; error: number };
  present_columns: Set<string>;
}

function trim(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function parsePrice(s: string | null, errors: FieldError[]): number {
  if (!s) { errors.push({ field: 'price', message: 'required' }); return 0; }
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) { errors.push({ field: 'price', message: 'not a number' }); return 0; }
  if (n < 0) { errors.push({ field: 'price', message: 'must be >= 0' }); return 0; }
  return Math.round(n * 100);
}

export function parseDecimal(
  s: string | null,
  errors: FieldError[],
  opts: { field: string; min?: number; max?: number; allowNull?: boolean },
): number | null {
  if (s == null || s.trim() === '') {
    if (opts.allowNull) return null;
    errors.push({ field: opts.field, message: 'required' });
    return null;
  }
  const cleaned = s.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') {
    errors.push({ field: opts.field, message: 'not a number' });
    return null;
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    errors.push({ field: opts.field, message: 'not a number' });
    return null;
  }
  if (opts.min != null && n < opts.min) {
    errors.push({ field: opts.field, message: `must be >= ${opts.min}` });
    return null;
  }
  if (opts.max != null && n > opts.max) {
    errors.push({ field: opts.field, message: `must be <= ${opts.max}` });
    return null;
  }
  return n;
}

export function parseIntCell(
  s: string | null,
  errors: FieldError[],
  opts: { field: string; min: number; allowNull?: boolean },
): number | null {
  if (s == null || s.trim() === '') {
    if (opts.allowNull) return null;
    errors.push({ field: opts.field, message: 'required' });
    return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    errors.push({ field: opts.field, message: 'not a number' });
    return null;
  }
  if (!Number.isInteger(n)) {
    errors.push({ field: opts.field, message: 'must be an integer' });
    return null;
  }
  if (n < opts.min) {
    errors.push({ field: opts.field, message: `must be >= ${opts.min}` });
    return null;
  }
  return n;
}

export function parseTimestamp(
  s: string | number | null,
  errors: FieldError[],
  opts: { field: string },
): string | null {
  if (s == null || (typeof s === 'string' && s.trim() === '')) return null;

  // XLSX-serial numeric branch.
  // Known limitation: XLSX library serializes Date cells in the writer's local
  // timezone. Fixtures must be authored under TZ=UTC for consistent reads.
  // End-user XLSX files created in non-UTC timezones may show date drift on
  // or near midnight UTC. Future hardening could detect Date-typed cells via
  // cellDates:true on read + an instanceof Date branch here.
  //
  // Excel-serial date (XLSX emits these as numbers when cellDates is false).
  // Use Math.floor to strip any timezone-offset fractional that XLSX adds when
  // parsing bare YYYY-MM-DD strings from CSV in local time — ensures midnight UTC.
  if (typeof s === 'number') {
    const parts = XLSX.SSF.parse_date_code(Math.floor(s));
    if (!parts) {
      errors.push({ field: opts.field, message: 'invalid date serial' });
      return null;
    }
    const iso = new Date(Date.UTC(parts.y, parts.m - 1, parts.d, parts.H, parts.M, Math.floor(parts.S))).toISOString();
    return iso;
  }

  // YYYY-MM-DD shorthand
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) {
      errors.push({ field: opts.field, message: 'invalid date' });
      return null;
    }
    return d.toISOString();
  }

  // Full ISO
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    errors.push({ field: opts.field, message: 'invalid date' });
    return null;
  }
  return d.toISOString();
}

export function parseEnum<T extends string>(
  s: string | null,
  whitelist: readonly T[],
  errors: FieldError[],
  opts: { field: string; allowNull?: boolean },
): T | null {
  if (s == null || s.trim() === '') {
    if (opts.allowNull) return null;
    errors.push({ field: opts.field, message: 'required' });
    return null;
  }
  const normalized = s.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (whitelist.includes(normalized as T)) return normalized as T;
  errors.push({ field: opts.field, message: `must be ${whitelist.join('|')}` });
  return null;
}

function trimStr(raw: Record<string, unknown>, present: Set<string>, key: string): string | null {
  if (!present.has(key)) return null;
  const v = raw[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

const CONDITION_VALUES = ['new', 'refurbished', 'used'] as const;
const AVAILABILITY_VALUES = ['in_stock', 'out_of_stock', 'preorder', 'discontinued'] as const;

function parseRow(raw: Record<string, unknown>, idx: number, present: Set<string>): ParsedImportRow {
  const errors: FieldError[] = [];
  const sku  = trim(raw['sku']);
  const name = trim(raw['name']);
  if (!name) errors.push({ field: 'name', message: 'required' });

  const typeRaw = (trim(raw['type']) ?? '').toLowerCase();
  if (typeRaw !== 'physical' && typeRaw !== 'service') {
    errors.push({ field: 'type', message: 'must be physical|service' });
  }
  const type: 'physical' | 'service' = typeRaw === 'service' ? 'service' : 'physical';

  const price_cents = parsePrice(trim(raw['price']), errors);
  const currency = (trim(raw['currency']) ?? 'USD').toUpperCase();
  if (currency !== 'USD') errors.push({ field: 'currency', message: 'Phase A locks to USD' });

  const stockRaw = trim(raw['stock_qty']);
  let stock_qty: number | null = null;
  if (stockRaw != null) {
    const n = Number(stockRaw);
    if (!Number.isInteger(n) || n < 0) errors.push({ field: 'stock_qty', message: 'integer >= 0' });
    else stock_qty = n;
  }

  const unit = trim(raw['unit']);
  const statusRaw = (trim(raw['status']) ?? 'draft').toLowerCase();
  const status = (['active', 'draft', 'archived'].includes(statusRaw) ? statusRaw : 'draft') as 'active' | 'draft' | 'archived';
  const tagsRaw = trim(raw['tags']) ?? '';
  const tags = tagsRaw.length === 0 ? [] : tagsRaw.split(';').map((t) => t.trim()).filter(Boolean);

  errors.push(...validateTypeFields({ type, sku, stock_qty, unit }));

  // Phase B reads (only when header present)
  const gtin = trimStr(raw, present, 'gtin');
  const mpn = trimStr(raw, present, 'mpn');
  const conditionCell = trimStr(raw, present, 'condition');
  const condition = present.has('condition')
    ? parseEnum(conditionCell, CONDITION_VALUES, errors, { field: 'condition', allowNull: true })
    : null;
  const availabilityCell = trimStr(raw, present, 'availability');
  const availability = present.has('availability')
    ? parseEnum(availabilityCell, AVAILABILITY_VALUES, errors, { field: 'availability', allowNull: true })
    : null;

  const salePriceCell = trimStr(raw, present, 'sale_price');
  const sale_price_cents = present.has('sale_price')
    ? (salePriceCell == null ? null : Math.round((parseDecimal(salePriceCell, errors, { field: 'sale_price', min: 0, allowNull: true }) ?? 0) * 100))
    : null;

  const sale_starts_at = present.has('sale_starts_at')
    ? parseTimestamp(typeof raw['sale_starts_at'] === 'number' ? raw['sale_starts_at'] as number : trimStr(raw, present, 'sale_starts_at'), errors, { field: 'sale_starts_at' })
    : null;
  const sale_ends_at = present.has('sale_ends_at')
    ? parseTimestamp(typeof raw['sale_ends_at'] === 'number' ? raw['sale_ends_at'] as number : trimStr(raw, present, 'sale_ends_at'), errors, { field: 'sale_ends_at' })
    : null;

  const weight_grams = present.has('weight_grams')
    ? parseIntCell(trimStr(raw, present, 'weight_grams'), errors, { field: 'weight_grams', min: 0, allowNull: true })
    : null;
  const length_mm = present.has('length_mm')
    ? parseIntCell(trimStr(raw, present, 'length_mm'), errors, { field: 'length_mm', min: 0, allowNull: true })
    : null;
  const width_mm = present.has('width_mm')
    ? parseIntCell(trimStr(raw, present, 'width_mm'), errors, { field: 'width_mm', min: 0, allowNull: true })
    : null;
  const height_mm = present.has('height_mm')
    ? parseIntCell(trimStr(raw, present, 'height_mm'), errors, { field: 'height_mm', min: 0, allowNull: true })
    : null;

  const gst_rate = present.has('gst_rate')
    ? parseDecimal(trimStr(raw, present, 'gst_rate'), errors, { field: 'gst_rate', min: 0, max: 100, allowNull: true })
    : null;

  // Cross-field validation: sale window date order
  if (sale_starts_at && sale_ends_at && new Date(sale_starts_at).getTime() > new Date(sale_ends_at).getTime()) {
    errors.push({ field: 'sale_ends_at', message: 'must not be before sale_starts_at' });
  }


  return {
    row_index: idx + 2,
    sku, name: name ?? '', type,
    category_name: trim(raw['category']),
    brand: trim(raw['brand']),
    price_cents, currency,
    stock_qty: type === 'service' ? null : stock_qty,
    unit:      type === 'service' ? null : unit,
    status, tags,
    description: trim(raw['description']),
    gtin, mpn, condition, availability,
    sale_price_cents, sale_starts_at, sale_ends_at,
    weight_grams, length_mm, width_mm, height_mm,
    color: trimStr(raw, present, 'color'),
    size: trimStr(raw, present, 'size'),
    material: trimStr(raw, present, 'material'),
    gender: trimStr(raw, present, 'gender'),
    age_group: trimStr(raw, present, 'age_group'),
    manufacturer: trimStr(raw, present, 'manufacturer'),
    country_of_origin: trimStr(raw, present, 'country_of_origin'),
    hsn_code: trimStr(raw, present, 'hsn_code'),
    gst_rate,
    google_category: trimStr(raw, present, 'google_category'),
    meta_category: trimStr(raw, present, 'meta_category'),
    product_url: trimStr(raw, present, 'product_url'),
    errors,
  };
}

export function parseCsvBytes(bytes: Uint8Array | Buffer): ParsedImport {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  // Normalize every row's keys to trimmed-lowercase. Compute present_columns
  // from the first row's normalized keys (XLSX uses the header row for keys).
  const normalized = raw.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k.trim().toLowerCase()] = v;
    return out;
  });

  const present_columns = new Set<string>(
    normalized[0] ? Object.keys(normalized[0]) : [],
  );

  const rows = normalized.map((r, i) => parseRow(r, i, present_columns));
  const valid = rows.filter((r) => r.errors.length === 0).length;
  return { rows, meta: { total: rows.length, valid, error: rows.length - valid }, present_columns };
}

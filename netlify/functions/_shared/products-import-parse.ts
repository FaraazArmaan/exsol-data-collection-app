// CSV/XLSX byte-buffer → typed product rows with per-row error lists.
// Used by u-products-import for both the dry-run preview and the commit pass.

import * as XLSX from 'xlsx';
import { validateTypeFields, type FieldError } from './products-validate';

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
  errors: FieldError[];
}

export interface ParsedImport {
  rows: ParsedImportRow[];
  meta: { total: number; valid: number; error: number };
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

  // Excel-serial date (XLSX emits these as numbers when cellDates is false).
  if (typeof s === 'number') {
    const parts = XLSX.SSF.parse_date_code(s);
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

function parseRow(raw: Record<string, unknown>, idx: number): ParsedImportRow {
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
    errors,
  };
}

export function parseCsvBytes(bytes: Uint8Array | Buffer): ParsedImport {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const rows = raw.map((r, i) => parseRow(r, i));
  const valid = rows.filter((r) => r.errors.length === 0).length;
  return { rows, meta: { total: rows.length, valid, error: rows.length - valid } };
}

# CSV Import — Phase B Field Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `POST /api/u-products-import` so it accepts all 23 Phase B product columns (gtin, mpn, condition, availability, sale_price, sale dates, dims, attributes, taxonomy) — while leaving existing 12-column CSVs behaving exactly as before.

**Architecture:** Extend the single parser at `_shared/products-import-parse.ts` with case-insensitive header normalization and a per-file `present_columns: Set<string>`. Add four pure typed helpers (`parseDecimal`, `parseIntCell`, `parseTimestamp`, `parseEnum`). In the handler, INSERT lists every Phase A + B column statically; UPDATE switches to a single static SQL template where each Phase B column is `CASE WHEN ${present.has('x')}::boolean THEN ${r.x} ELSE x END`. The Neon driver only exposes the tagged-template function (no `sql.join`/`sql.unsafe`), so the static template with parameterized presence booleans is the primary approach, not a fallback.

**Tech Stack:** TypeScript, `@neondatabase/serverless`, `xlsx` (for CSV+XLSX parsing including `XLSX.SSF.parse_date_code` for Excel date serials), Vitest. No new dependencies. No DB migration (037 already applied to dev + prod).

---

## Key references

- **Spec:** `docs/superpowers/specs/2026-06-10-csv-import-phase-b-design.md`
- **Parser to extend:** `netlify/functions/_shared/products-import-parse.ts`
- **Handler to extend:** `netlify/functions/u-products-import.ts`
- **Validators (already cover the types we need):** `netlify/functions/_shared/products-validate.ts:50-115`
- **DB shape:** `db/migrations/037_products_platform_fields.sql` — note `condition`/`availability` are `TEXT NOT NULL DEFAULT 'new'/'in_stock'` with CHECK constraints, NOT enum types. Cast columns: `sale_starts_at::timestamptz`, `sale_ends_at::timestamptz`. No casts needed for the other Phase B columns.
- **Existing unit tests:** `tests/unit/products-import-parse.test.ts`
- **Existing integration tests:** `tests/integration/u-products-import.test.ts`
- **Existing fixtures:** `tests/fixtures/products/import-valid.csv`, `import-mixed-errors.csv`

## Constants to use across tasks

The full set of Phase B column names is referenced repeatedly. Define it once in the parser file and import where needed.

```ts
// In _shared/products-import-parse.ts
export const PHASE_B_HEADERS = [
  'gtin', 'mpn', 'condition', 'availability',
  'sale_price', 'sale_starts_at', 'sale_ends_at',
  'weight_grams', 'length_mm', 'width_mm', 'height_mm',
  'color', 'size', 'material', 'gender', 'age_group',
  'manufacturer', 'country_of_origin', 'hsn_code', 'gst_rate',
  'google_category', 'meta_category', 'product_url',
] as const;
export type PhaseBHeader = typeof PHASE_B_HEADERS[number];
```

Note that the CSV header `sale_price` corresponds to the DB column `sale_price_cents`. All other Phase B headers match their DB column names 1:1.

---

### Task 1: Add the four parser helpers (TDD)

**Files:**
- Modify: `netlify/functions/_shared/products-import-parse.ts`
- Test: `tests/unit/products-import-parse.test.ts`

- [ ] **Step 1: Add failing tests for the four helpers**

Append to `tests/unit/products-import-parse.test.ts`:

```ts
import {
  parseDecimal, parseIntCell, parseTimestamp, parseEnum,
} from '../../netlify/functions/_shared/products-import-parse';
import type { FieldError } from '../../netlify/functions/_shared/products-validate';

describe('parseDecimal', () => {
  it('parses a plain decimal', () => {
    const errs: FieldError[] = [];
    expect(parseDecimal('18.5', errs, { field: 'gst_rate', min: 0, max: 100 })).toBe(18.5);
    expect(errs).toEqual([]);
  });
  it('returns null for empty when allowNull', () => {
    const errs: FieldError[] = [];
    expect(parseDecimal(null, errs, { field: 'gst_rate', allowNull: true })).toBeNull();
    expect(errs).toEqual([]);
  });
  it('errors on out-of-range', () => {
    const errs: FieldError[] = [];
    expect(parseDecimal('120', errs, { field: 'gst_rate', max: 100 })).toBeNull();
    expect(errs).toEqual([{ field: 'gst_rate', message: 'must be <= 100' }]);
  });
  it('errors on non-numeric', () => {
    const errs: FieldError[] = [];
    parseDecimal('abc', errs, { field: 'gst_rate' });
    expect(errs).toEqual([{ field: 'gst_rate', message: 'not a number' }]);
  });
});

describe('parseIntCell', () => {
  it('parses a positive integer', () => {
    const errs: FieldError[] = [];
    expect(parseIntCell('150', errs, { field: 'weight_grams', min: 0 })).toBe(150);
  });
  it('rejects a decimal', () => {
    const errs: FieldError[] = [];
    parseIntCell('12.7', errs, { field: 'length_mm', min: 0 });
    expect(errs).toEqual([{ field: 'length_mm', message: 'must be an integer' }]);
  });
  it('rejects negative', () => {
    const errs: FieldError[] = [];
    parseIntCell('-1', errs, { field: 'weight_grams', min: 0 });
    expect(errs[0]!.message).toMatch(/>= 0/);
  });
  it('returns null on empty when allowNull', () => {
    const errs: FieldError[] = [];
    expect(parseIntCell(null, errs, { field: 'weight_grams', min: 0, allowNull: true })).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('parses YYYY-MM-DD as midnight UTC', () => {
    const errs: FieldError[] = [];
    expect(parseTimestamp('2026-07-15', errs, { field: 'sale_starts_at' }))
      .toBe('2026-07-15T00:00:00.000Z');
  });
  it('passes ISO through normalized', () => {
    const errs: FieldError[] = [];
    expect(parseTimestamp('2026-07-15T14:30:00Z', errs, { field: 'sale_starts_at' }))
      .toBe('2026-07-15T14:30:00.000Z');
  });
  it('returns null on empty', () => {
    const errs: FieldError[] = [];
    expect(parseTimestamp(null, errs, { field: 'sale_starts_at' })).toBeNull();
  });
  it('errors on garbage', () => {
    const errs: FieldError[] = [];
    parseTimestamp('not-a-date', errs, { field: 'sale_starts_at' });
    expect(errs[0]!.message).toMatch(/invalid date/i);
  });
});

describe('parseEnum', () => {
  const COND = ['new', 'refurbished', 'used'] as const;
  it('normalizes spacing and case', () => {
    const errs: FieldError[] = [];
    expect(parseEnum('In-Stock', ['in_stock', 'out_of_stock'] as const, errs, { field: 'availability' }))
      .toBe('in_stock');
    expect(parseEnum('NEW', COND, errs, { field: 'condition' })).toBe('new');
    expect(parseEnum('refurbished', COND, errs, { field: 'condition' })).toBe('refurbished');
    expect(errs).toEqual([]);
  });
  it('errors on mismatch', () => {
    const errs: FieldError[] = [];
    parseEnum('sometimes', ['always', 'never'] as const, errs, { field: 'cadence' });
    expect(errs[0]!.message).toMatch(/must be/);
  });
  it('returns null on empty when allowNull', () => {
    const errs: FieldError[] = [];
    expect(parseEnum(null, COND, errs, { field: 'condition', allowNull: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the new tests, confirm they fail with "is not a function" / "is not exported"**

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol Data Collection App"
npx vitest run tests/unit/products-import-parse.test.ts 2>&1 | tail -20
```

Expected: 4 new describe blocks all fail; old `parseCsvBytes` tests still pass.

- [ ] **Step 3: Add the four helpers to `_shared/products-import-parse.ts`**

Add the `PHASE_B_HEADERS` constant from the "Constants to use" section above. Then add these helpers after the existing `parsePrice` function:

```ts
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
```

- [ ] **Step 4: Run tests, confirm they pass**

```bash
npx vitest run tests/unit/products-import-parse.test.ts 2>&1 | tail -20
```

Expected: all green.

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/products-import-parse.ts tests/unit/products-import-parse.test.ts
git commit -m "feat(import): add parseDecimal/parseIntCell/parseTimestamp/parseEnum helpers"
```

---

### Task 2: Header normalization and `present_columns` (TDD)

**Files:**
- Modify: `netlify/functions/_shared/products-import-parse.ts`
- Test: `tests/unit/products-import-parse.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe('parseCsvBytes header normalization', () => {
  it('exposes present_columns for the CSV header row (lowercased + trimmed)', () => {
    const csv = `SKU, name , type, gtin\nW-1,Widget,physical,1234`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.present_columns.has('sku')).toBe(true);
    expect(r.present_columns.has('name')).toBe(true);
    expect(r.present_columns.has('gtin')).toBe(true);
    // Existing columns absent from header should NOT be in the set
    expect(r.present_columns.has('brand')).toBe(false);
  });

  it('matches headers case-insensitively when reading row values', () => {
    const csv = `SKU,Name,Type,Price\nW-1,Widget,physical,12.50`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.rows[0]!.name).toBe('Widget');
    expect(r.rows[0]!.price_cents).toBe(1250);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/unit/products-import-parse.test.ts -t "present_columns" 2>&1 | tail -10
```

Expected: fails — `present_columns` doesn't exist on the result.

- [ ] **Step 3: Implement in `_shared/products-import-parse.ts`**

Update `ParsedImport`:

```ts
export interface ParsedImport {
  rows: ParsedImportRow[];
  meta: { total: number; valid: number; error: number };
  present_columns: Set<string>;
}
```

Replace the body of `parseCsvBytes` with:

```ts
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
```

Update `parseRow` signature to accept the present set (it doesn't use it yet — that wires up in Task 3):

```ts
function parseRow(raw: Record<string, unknown>, idx: number, _present: Set<string>): ParsedImportRow {
  // ...existing body unchanged for now...
}
```

- [ ] **Step 4: Run all parser tests**

```bash
npx vitest run tests/unit/products-import-parse.test.ts 2>&1 | tail -20
```

Expected: all green including the new ones.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. The new `present_columns` field is read by callers in Task 5 onward — they may have a type error if they destructure ParsedImport with strict shape. Search and fix any breaks:

```bash
grep -rn "ParsedImport[^R]" netlify/ tests/ src/ 2>/dev/null | grep -v node_modules
```

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/_shared/products-import-parse.ts tests/unit/products-import-parse.test.ts
git commit -m "feat(import): normalize CSV headers + expose present_columns"
```

---

### Task 3: Extend `ParsedImportRow` and `parseRow` with all 23 Phase B fields (TDD)

**Files:**
- Modify: `netlify/functions/_shared/products-import-parse.ts`
- Test: `tests/unit/products-import-parse.test.ts`
- Create: `tests/fixtures/products/import-phase-b-full.csv`

- [ ] **Step 1: Create the full-fixture CSV**

`tests/fixtures/products/import-phase-b-full.csv`:

```csv
sku,name,type,category,brand,price,currency,stock_qty,unit,status,tags,description,gtin,mpn,condition,availability,sale_price,sale_starts_at,sale_ends_at,weight_grams,length_mm,width_mm,height_mm,color,size,material,gender,age_group,manufacturer,country_of_origin,hsn_code,gst_rate,google_category,meta_category,product_url
WH-1,Wireless Headphones,physical,Electronics,SoundLab,129.00,USD,24,each,active,wireless;audio,Premium over-ear,1234567890123,SL-WH-1,new,in_stock,99.00,2026-07-01T00:00:00Z,2026-07-31T23:59:59Z,250,200,180,80,Black,One Size,Plastic,Unisex,Adult,SoundLab Inc,India,851830,18,Electronics > Audio > Headphones,Electronics & Accessories,https://example.com/wh-1
SVC-FIX,Repair Service,service,Services,,80.00,USD,,,active,onsite,1-hour minimum,,,refurbished,in_stock,,,,,,,,,,,,,,,,,,
USB-1,USB-C Hub,physical,Electronics,HubCo,45.00,USD,5,each,draft,,,,,used,out_of_stock,,,,150,90,60,20,Silver,,Aluminum,,,HubCo Ltd,China,851770,18,,,
```

- [ ] **Step 2: Add failing tests**

Append:

```ts
describe('parseRow Phase B fields', () => {
  function rowFromCsv(csv: string) {
    const r = parseCsvBytes(Buffer.from(csv));
    return r.rows[0]!;
  }

  it('reads gtin/mpn/color/size as trimmed strings', () => {
    const csv = `sku,name,type,price,gtin,mpn,color,size\nW,Widget,physical,1,  9876  ,M-1,Red,Medium`;
    const r = rowFromCsv(csv);
    expect(r.gtin).toBe('9876');
    expect(r.mpn).toBe('M-1');
    expect(r.color).toBe('Red');
    expect(r.size).toBe('Medium');
  });

  it('reads condition + availability via normalized enum', () => {
    const csv = `sku,name,type,price,condition,availability\nW,Widget,physical,1,Refurbished,Out-of-Stock`;
    const r = rowFromCsv(csv);
    expect(r.condition).toBe('refurbished');
    expect(r.availability).toBe('out_of_stock');
    expect(r.errors).toEqual([]);
  });

  it('errors on invalid condition', () => {
    const csv = `sku,name,type,price,condition\nW,Widget,physical,1,broken`;
    const r = rowFromCsv(csv);
    expect(r.errors.some((e) => e.field === 'condition')).toBe(true);
  });

  it('reads sale_price as cents', () => {
    const csv = `sku,name,type,price,sale_price\nW,Widget,physical,1,9.50`;
    const r = rowFromCsv(csv);
    expect(r.sale_price_cents).toBe(950);
  });

  it('sale_price empty cell is null (not 0)', () => {
    const csv = `sku,name,type,price,sale_price\nW,Widget,physical,1,`;
    const r = rowFromCsv(csv);
    expect(r.sale_price_cents).toBeNull();
    expect(r.errors).toEqual([]);
  });

  it('reads dimensions as integers', () => {
    const csv = `sku,name,type,price,weight_grams,length_mm,width_mm,height_mm\nW,Widget,physical,1,250,200,180,80`;
    const r = rowFromCsv(csv);
    expect(r.weight_grams).toBe(250);
    expect(r.length_mm).toBe(200);
    expect(r.width_mm).toBe(180);
    expect(r.height_mm).toBe(80);
  });

  it('reads gst_rate as decimal', () => {
    const csv = `sku,name,type,price,gst_rate\nW,Widget,physical,1,18.5`;
    const r = rowFromCsv(csv);
    expect(r.gst_rate).toBe(18.5);
  });

  it('reads sale dates as ISO strings', () => {
    const csv = `sku,name,type,price,sale_starts_at,sale_ends_at\nW,Widget,physical,1,2026-07-01,2026-07-31T23:59:59Z`;
    const r = rowFromCsv(csv);
    expect(r.sale_starts_at).toBe('2026-07-01T00:00:00.000Z');
    expect(r.sale_ends_at).toBe('2026-07-31T23:59:59.000Z');
  });

  it('parses the full Phase B fixture without errors', () => {
    const bytes = readFileSync(join(__dirname, '../fixtures/products/import-phase-b-full.csv'));
    const r = parseCsvBytes(bytes);
    expect(r.rows).toHaveLength(3);
    expect(r.meta.error).toBe(0);
    expect(r.rows[0]!.gtin).toBe('1234567890123');
    expect(r.rows[0]!.gst_rate).toBe(18);
    expect(r.rows[0]!.country_of_origin).toBe('India');
  });

  it('absent Phase B header → field is null and not in present_columns', () => {
    const csv = `sku,name,type,price\nW,Widget,physical,1`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.present_columns.has('gtin')).toBe(false);
    expect(r.rows[0]!.gtin).toBeNull();
  });
});
```

- [ ] **Step 3: Run, confirm failure**

```bash
npx vitest run tests/unit/products-import-parse.test.ts -t "Phase B fields" 2>&1 | tail -20
```

Expected: most fail (fields don't exist on `ParsedImportRow`).

- [ ] **Step 4: Extend `ParsedImportRow` interface**

Replace the existing interface in `_shared/products-import-parse.ts`:

```ts
import type { Condition, Availability } from './products-validate';

export interface ParsedImportRow {
  row_index: number;
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
```

- [ ] **Step 5: Extend `parseRow`**

Replace the body of `parseRow` with a version that reads Phase B fields when their headers are present. Keep all existing parsing logic untouched.

```ts
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
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/unit/products-import-parse.test.ts 2>&1 | tail -20
```

Expected: all green. `npm run typecheck` clean.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/_shared/products-import-parse.ts tests/unit/products-import-parse.test.ts tests/fixtures/products/import-phase-b-full.csv
git commit -m "feat(import): parse 23 Phase B columns with header-presence gating"
```

---

### Task 4: Cross-field validation — sale-window error + sale_price-without-window warning (TDD)

**Files:**
- Modify: `netlify/functions/_shared/products-import-parse.ts`
- Modify: `netlify/functions/u-products-import.ts` (to emit warning, since warnings live in the handler, not the row)
- Test: `tests/unit/products-import-parse.test.ts`
- Test: `tests/integration/u-products-import.test.ts`

- [ ] **Step 1: Unit test for sale-window order error**

Append to `tests/unit/products-import-parse.test.ts`:

```ts
describe('parseRow cross-field validation', () => {
  it('errors when sale_starts_at > sale_ends_at', () => {
    const csv = `sku,name,type,price,sale_starts_at,sale_ends_at\nW,Widget,physical,1,2026-08-01,2026-07-15`;
    const r = parseCsvBytes(Buffer.from(csv));
    expect(r.rows[0]!.errors.some((e) => e.field === 'sale_ends_at' && /before sale_starts_at/.test(e.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Add the check at the end of `parseRow`, before the return**

Before the `return { ... }` in `parseRow`:

```ts
if (sale_starts_at && sale_ends_at && new Date(sale_starts_at).getTime() > new Date(sale_ends_at).getTime()) {
  errors.push({ field: 'sale_ends_at', message: 'must not be before sale_starts_at' });
}
```

- [ ] **Step 3: Run unit tests, confirm green**

```bash
npx vitest run tests/unit/products-import-parse.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Add integration test for the sale_price-without-window warning**

Open `tests/integration/u-products-import.test.ts` and add (use the same setup helpers the file already defines; do not redeclare them — reuse the `createClient`/`adminCookie`/etc. that the file already uses):

```ts
it('emits a warning when sale_price is set without a sale window', async () => {
  const csv = [
    'sku,name,type,price,sale_price,sale_starts_at',
    'W-SP,Widget,physical,10.00,5.00,',
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv]), 'p.csv');
  const r = await uProductsImportHandler(
    new Request(`http://localhost/api/u-products-import?dry_run=1&client=${clientId}`, {
      method: 'POST', headers: { cookie }, body: form,
    }), CTX,
  );
  expect(r.status).toBe(200);
  const body = await r.json() as { warnings: Array<{ row: number; message: string }> };
  expect(body.warnings.some((w) => /sale price.*no sale window/i.test(w.message))).toBe(true);
});
```

- [ ] **Step 5: Add the warning emission in `u-products-import.ts`**

After the existing category-warning loop (around line 96-103), add the sale-window warning before `if (r.errors.length > 0) continue;`:

```ts
// Phase B: warn if sale_price set without a sale window.
if (r.sale_price_cents != null && r.sale_starts_at == null) {
  warnings.push({ row: r.row_index, message: 'sale price set but no sale window — will apply immediately' });
}
```

- [ ] **Step 6: Run integration test in isolation**

```bash
npx vitest run tests/integration/u-products-import.test.ts -t "sale_price.*warning" 2>&1 | tail -10
```

Expected: passes.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add netlify/functions/_shared/products-import-parse.ts netlify/functions/u-products-import.ts tests/unit/products-import-parse.test.ts tests/integration/u-products-import.test.ts
git commit -m "feat(import): sale-window date order check + sale_price-without-window warning"
```

---

### Task 5: Excel-serial date fixture + parser test

**Files:**
- Create: `tests/fixtures/products/import-phase-b-dates.xlsx` (generated programmatically — see step)
- Test: `tests/unit/products-import-parse.test.ts`

- [ ] **Step 1: Generate the XLSX fixture from a tiny script**

Create `scripts/gen-phase-b-dates-fixture.ts`:

```ts
import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const aoa = [
  ['sku', 'name', 'type', 'price', 'sale_starts_at', 'sale_ends_at'],
  ['W-1', 'Widget', 'physical', 10, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z')],
];
const sheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
writeFileSync(join(__dirname, '../tests/fixtures/products/import-phase-b-dates.xlsx'), buf);
console.log('wrote import-phase-b-dates.xlsx');
```

Run:

```bash
npx tsx scripts/gen-phase-b-dates-fixture.ts
```

Confirm the file exists:

```bash
ls -la tests/fixtures/products/import-phase-b-dates.xlsx
```

- [ ] **Step 2: Add a parser test that reads the XLSX**

Append to `tests/unit/products-import-parse.test.ts`:

```ts
describe('XLSX date serial', () => {
  it('parses Excel date cells to ISO timestamps', () => {
    const bytes = readFileSync(join(__dirname, '../fixtures/products/import-phase-b-dates.xlsx'));
    const r = parseCsvBytes(bytes);
    expect(r.rows[0]!.sale_starts_at).toMatch(/^2026-08-01T/);
    expect(r.rows[0]!.sale_ends_at).toMatch(/^2026-08-31T/);
    expect(r.rows[0]!.errors.filter((e) => e.field.startsWith('sale_'))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, expect green**

```bash
npx vitest run tests/unit/products-import-parse.test.ts -t "XLSX date serial" 2>&1 | tail -10
```

If the date comes through as a raw number rather than a Date object, the parser's `parseTimestamp` already handles the numeric branch via `XLSX.SSF.parse_date_code`. If it comes through as a JS Date (which happens when `XLSX.read` is given `cellDates: true`), check whether `parseTimestamp` needs to handle the Date type — extend it:

```ts
if (s instanceof Date) {
  if (Number.isNaN(s.getTime())) {
    errors.push({ field: opts.field, message: 'invalid date' });
    return null;
  }
  return s.toISOString();
}
```

(Add this branch at the top of `parseTimestamp` before the numeric branch.) Update the `parseTimestamp` signature accordingly: `s: string | number | Date | null`.

- [ ] **Step 4: Re-run after any adjustment, then typecheck**

```bash
npx vitest run tests/unit/products-import-parse.test.ts 2>&1 | tail -10
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/products/import-phase-b-dates.xlsx tests/unit/products-import-parse.test.ts scripts/gen-phase-b-dates-fixture.ts netlify/functions/_shared/products-import-parse.ts
git commit -m "test(import): xlsx date-cell fixture + parser support for Excel date cells"
```

---

### Task 6: Backward-compat regression integration test

**Why this comes BEFORE handler edits:** It pins the no-wipe contract. It MUST pass on `HEAD` (before any handler change) because the current handler only writes the original 12 columns. After Task 7 extends INSERT, this test continues to assert UPDATE behavior — which Task 8 changes — and must still pass.

**Files:**
- Test: `tests/integration/u-products-import.test.ts`

- [ ] **Step 1: Add the regression test**

Append to `u-products-import.test.ts` (reuse the existing test-file setup helpers — `clientId`, `cookie`, `CTX`, `uProductsImportHandler`, the `sql` exported from `_shared/db`. Match the style of the other integration tests in that file):

```ts
it('legacy 12-column CSV does NOT wipe Phase B columns on existing products', async () => {
  // Seed an existing product with all Phase B columns populated via SQL directly.
  const seededSku = `BC-${Date.now()}`;
  await sql`
    INSERT INTO public.products (
      client_id, type, name, sku, price_cents,
      gtin, mpn, condition, availability,
      sale_price_cents, weight_grams, color, gst_rate,
      country_of_origin, hsn_code
    ) VALUES (
      ${clientId}::uuid, 'physical', 'Seeded', ${seededSku}, 1000,
      'GTIN-X', 'MPN-X', 'refurbished', 'preorder',
      900, 250, 'Red', 18.0, 'India', 'HSN-X'
    )
  `;

  // Re-import via legacy 12-column CSV (no Phase B headers) using same SKU.
  const csv = [
    'sku,name,type,category,brand,price,currency,stock_qty,unit,status,tags,description',
    `${seededSku},Updated Name,physical,Electronics,,15.00,USD,3,each,active,,Updated description`,
  ].join('\n');

  const form = new FormData();
  form.append('file', new Blob([csv]), 'p.csv');
  const r = await uProductsImportHandler(
    new Request(`http://localhost/api/u-products-import?client=${clientId}`, {
      method: 'POST', headers: { cookie }, body: form,
    }), CTX,
  );
  expect(r.status).toBe(200);

  // Verify: name + description updated, every Phase B column preserved.
  const rows = await sql`
    SELECT name, description, gtin, mpn, condition, availability,
           sale_price_cents, weight_grams, color, gst_rate,
           country_of_origin, hsn_code
    FROM public.products WHERE sku = ${seededSku} AND client_id = ${clientId}::uuid
  ` as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row.name).toBe('Updated Name');
  expect(row.description).toBe('Updated description');
  expect(row.gtin).toBe('GTIN-X');
  expect(row.mpn).toBe('MPN-X');
  expect(row.condition).toBe('refurbished');
  expect(row.availability).toBe('preorder');
  expect(row.sale_price_cents).toBe(900);
  expect(row.weight_grams).toBe(250);
  expect(row.color).toBe('Red');
  expect(String(row.gst_rate)).toBe('18.00'); // NUMERIC returns as string
  expect(row.country_of_origin).toBe('India');
  expect(row.hsn_code).toBe('HSN-X');
});
```

- [ ] **Step 2: Run this test in isolation against HEAD**

```bash
npx vitest run tests/integration/u-products-import.test.ts -t "legacy 12-column CSV does NOT wipe" 2>&1 | tail -10
```

Expected: passes — current static UPDATE only touches the 12 original columns, so Phase B columns are inherently untouched.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/u-products-import.test.ts
git commit -m "test(import): regression test — legacy CSV must not wipe Phase B data"
```

---

### Task 7: Extend handler INSERT for Phase B columns

**Files:**
- Modify: `netlify/functions/u-products-import.ts`

- [ ] **Step 1: Test for the new INSERT happy path**

Append to `tests/integration/u-products-import.test.ts`:

```ts
it('imports new products with full Phase B field set', async () => {
  const csv = readFileSync(join(__dirname, '../fixtures/products/import-phase-b-full.csv'));
  const form = new FormData();
  form.append('file', new Blob([csv]), 'p.csv');
  const r = await uProductsImportHandler(
    new Request(`http://localhost/api/u-products-import?client=${clientId}`, {
      method: 'POST', headers: { cookie }, body: form,
    }), CTX,
  );
  expect(r.status).toBe(200);
  const body = await r.json() as { committed: boolean; summary: { to_create: number; to_update: number; errors: number } };
  expect(body.committed).toBe(true);
  expect(body.summary.errors).toBe(0);

  const rows = await sql`
    SELECT sku, gtin, condition, availability, sale_price_cents,
           weight_grams, length_mm, color, gst_rate, country_of_origin
    FROM public.products
    WHERE client_id = ${clientId}::uuid AND sku = 'WH-1'
  ` as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row.gtin).toBe('1234567890123');
  expect(row.condition).toBe('new');
  expect(row.availability).toBe('in_stock');
  expect(row.sale_price_cents).toBe(9900);
  expect(row.weight_grams).toBe(250);
  expect(row.length_mm).toBe(200);
  expect(row.color).toBe('Black');
  expect(String(row.gst_rate)).toBe('18.00');
  expect(row.country_of_origin).toBe('India');
});
```

- [ ] **Step 2: Run, confirm failure (Phase B columns won't be written by the existing INSERT)**

```bash
npx vitest run tests/integration/u-products-import.test.ts -t "imports new products with full Phase B" 2>&1 | tail -10
```

Expected: assertion fails on `row.gtin` (or earlier — current INSERT doesn't include Phase B columns).

- [ ] **Step 3: Replace the INSERT block in `u-products-import.ts`**

Find the existing `if (v.action === 'create') { const ins = await sql\` INSERT INTO ...` block (around lines 160-171). Replace with:

```ts
if (v.action === 'create') {
  const ins = (await sql`
    INSERT INTO public.products (
      client_id, type, name, description, category_id, brand, tags,
      price_cents, sku, stock_qty, unit, status, created_by_user_node,
      gtin, mpn, condition, availability,
      sale_price_cents, sale_starts_at, sale_ends_at,
      weight_grams, length_mm, width_mm, height_mm,
      color, size, material, gender, age_group,
      manufacturer, country_of_origin, hsn_code, gst_rate,
      google_category, meta_category, product_url
    ) VALUES (
      ${clientId}::uuid, ${r.type}, ${r.name}, ${r.description},
      ${category_id}::uuid, ${r.brand}, ${r.tags}::text[], ${r.price_cents},
      ${r.sku}, ${r.stock_qty}, ${r.unit}, ${r.status}, ${userNodeId}::uuid,
      ${r.gtin}, ${r.mpn},
      ${r.condition ?? 'new'}, ${r.availability ?? 'in_stock'},
      ${r.sale_price_cents}, ${r.sale_starts_at}::timestamptz, ${r.sale_ends_at}::timestamptz,
      ${r.weight_grams}, ${r.length_mm}, ${r.width_mm}, ${r.height_mm},
      ${r.color}, ${r.size}, ${r.material}, ${r.gender}, ${r.age_group},
      ${r.manufacturer}, ${r.country_of_origin}, ${r.hsn_code}, ${r.gst_rate},
      ${r.google_category}, ${r.meta_category}, ${r.product_url}
    ) RETURNING id
  `) as Array<{ id: string }>;
  createdIds.push(ins[0]!.id);
}
```

Note the `r.condition ?? 'new'` / `r.availability ?? 'in_stock'` — these columns are NOT NULL DEFAULT in the DB; sending NULL would violate the constraint, so the parser-null is mapped to the DB default at INSERT time.

- [ ] **Step 4: Run integration test, expect green**

```bash
npx vitest run tests/integration/u-products-import.test.ts -t "imports new products with full Phase B" 2>&1 | tail -10
```

- [ ] **Step 5: Run the full import test file to be sure no other case regressed**

```bash
npx vitest run tests/integration/u-products-import.test.ts 2>&1 | tail -20
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add netlify/functions/u-products-import.ts tests/integration/u-products-import.test.ts
git commit -m "feat(import): INSERT writes all 23 Phase B columns for new products"
```

---

### Task 8: Convert handler UPDATE to dynamic `CASE WHEN $present THEN $value ELSE col END`

**Files:**
- Modify: `netlify/functions/u-products-import.ts`

- [ ] **Step 1: Add tests for partial-UPDATE and empty-cell-clears**

Append to `tests/integration/u-products-import.test.ts`:

```ts
it('partial UPDATE: present headers overwrite; absent headers preserve', async () => {
  const seededSku = `P-${Date.now()}`;
  await sql`
    INSERT INTO public.products (
      client_id, type, name, sku, price_cents,
      gtin, mpn, condition, availability, weight_grams, color, gst_rate
    ) VALUES (
      ${clientId}::uuid, 'physical', 'Seed', ${seededSku}, 1000,
      'OLD-GTIN', 'OLD-MPN', 'refurbished', 'preorder', 500, 'Blue', 12.0
    )
  `;
  const csv = [
    'sku,name,type,price,condition,gst_rate',
    `${seededSku},Seed,physical,10.00,new,18`,
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv]), 'p.csv');
  const r = await uProductsImportHandler(
    new Request(`http://localhost/api/u-products-import?client=${clientId}`, {
      method: 'POST', headers: { cookie }, body: form,
    }), CTX,
  );
  expect(r.status).toBe(200);
  const rows = await sql`
    SELECT gtin, mpn, condition, availability, weight_grams, color, gst_rate
    FROM public.products WHERE sku = ${seededSku} AND client_id = ${clientId}::uuid
  ` as Array<Record<string, unknown>>;
  const row = rows[0]!;
  expect(row.condition).toBe('new');               // overwritten (header present)
  expect(String(row.gst_rate)).toBe('18.00');      // overwritten
  expect(row.gtin).toBe('OLD-GTIN');               // preserved (header absent)
  expect(row.mpn).toBe('OLD-MPN');                 // preserved
  expect(row.availability).toBe('preorder');       // preserved
  expect(row.weight_grams).toBe(500);              // preserved
  expect(row.color).toBe('Blue');                  // preserved
});

it('empty cell in present header clears the column to NULL', async () => {
  const seededSku = `EC-${Date.now()}`;
  await sql`
    INSERT INTO public.products (client_id, type, name, sku, price_cents, gtin)
    VALUES (${clientId}::uuid, 'physical', 'Seed', ${seededSku}, 1000, 'WILL-CLEAR')
  `;
  const csv = [
    'sku,name,type,price,gtin',
    `${seededSku},Seed,physical,10.00,`,
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv]), 'p.csv');
  await uProductsImportHandler(
    new Request(`http://localhost/api/u-products-import?client=${clientId}`, {
      method: 'POST', headers: { cookie }, body: form,
    }), CTX,
  );
  const rows = await sql`SELECT gtin FROM public.products WHERE sku = ${seededSku} AND client_id = ${clientId}::uuid` as Array<Record<string, unknown>>;
  expect(rows[0]!.gtin).toBeNull();
});
```

- [ ] **Step 2: Run, confirm failure**

```bash
npx vitest run tests/integration/u-products-import.test.ts -t "partial UPDATE" 2>&1 | tail -10
```

Expected: the partial-UPDATE test fails — current UPDATE doesn't touch Phase B columns at all, so `condition` stays `'refurbished'` instead of becoming `'new'`.

- [ ] **Step 3: Replace the UPDATE block in `u-products-import.ts`**

Pull `present_columns` from the parser result. At the top of the COMMIT phase, before the loop:

```ts
const present = parsed.present_columns;
```

Replace the existing `await sql\`UPDATE public.products SET ... WHERE id = ${v.id}::uuid AND client_id = ${clientId}::uuid\`` block (around lines 172-189) with:

```ts
} else if (v.id) {
  await sql`
    UPDATE public.products SET
      type        = ${r.type}::product_type,
      name        = ${r.name},
      description = ${r.description},
      category_id = ${category_id}::uuid,
      brand       = ${r.brand},
      tags        = ${r.tags}::text[],
      price_cents = ${r.price_cents},
      sku         = ${r.sku},
      stock_qty   = ${r.stock_qty},
      unit        = ${r.unit},
      status      = ${r.status}::product_status,
      gtin              = CASE WHEN ${present.has('gtin')}::boolean              THEN ${r.gtin}              ELSE gtin              END,
      mpn               = CASE WHEN ${present.has('mpn')}::boolean               THEN ${r.mpn}               ELSE mpn               END,
      condition         = CASE WHEN ${present.has('condition')}::boolean         THEN COALESCE(${r.condition}, 'new')         ELSE condition         END,
      availability      = CASE WHEN ${present.has('availability')}::boolean      THEN COALESCE(${r.availability}, 'in_stock') ELSE availability      END,
      sale_price_cents  = CASE WHEN ${present.has('sale_price')}::boolean        THEN ${r.sale_price_cents}  ELSE sale_price_cents  END,
      sale_starts_at    = CASE WHEN ${present.has('sale_starts_at')}::boolean    THEN ${r.sale_starts_at}::timestamptz ELSE sale_starts_at    END,
      sale_ends_at      = CASE WHEN ${present.has('sale_ends_at')}::boolean      THEN ${r.sale_ends_at}::timestamptz   ELSE sale_ends_at      END,
      weight_grams      = CASE WHEN ${present.has('weight_grams')}::boolean      THEN ${r.weight_grams}      ELSE weight_grams      END,
      length_mm         = CASE WHEN ${present.has('length_mm')}::boolean         THEN ${r.length_mm}         ELSE length_mm         END,
      width_mm          = CASE WHEN ${present.has('width_mm')}::boolean          THEN ${r.width_mm}          ELSE width_mm          END,
      height_mm         = CASE WHEN ${present.has('height_mm')}::boolean         THEN ${r.height_mm}         ELSE height_mm         END,
      color             = CASE WHEN ${present.has('color')}::boolean             THEN ${r.color}             ELSE color             END,
      size              = CASE WHEN ${present.has('size')}::boolean              THEN ${r.size}              ELSE size              END,
      material          = CASE WHEN ${present.has('material')}::boolean          THEN ${r.material}          ELSE material          END,
      gender            = CASE WHEN ${present.has('gender')}::boolean            THEN ${r.gender}            ELSE gender            END,
      age_group         = CASE WHEN ${present.has('age_group')}::boolean         THEN ${r.age_group}         ELSE age_group         END,
      manufacturer      = CASE WHEN ${present.has('manufacturer')}::boolean      THEN ${r.manufacturer}      ELSE manufacturer      END,
      country_of_origin = CASE WHEN ${present.has('country_of_origin')}::boolean THEN ${r.country_of_origin} ELSE country_of_origin END,
      hsn_code          = CASE WHEN ${present.has('hsn_code')}::boolean          THEN ${r.hsn_code}          ELSE hsn_code          END,
      gst_rate          = CASE WHEN ${present.has('gst_rate')}::boolean          THEN ${r.gst_rate}          ELSE gst_rate          END,
      google_category   = CASE WHEN ${present.has('google_category')}::boolean   THEN ${r.google_category}   ELSE google_category   END,
      meta_category     = CASE WHEN ${present.has('meta_category')}::boolean     THEN ${r.meta_category}     ELSE meta_category     END,
      product_url       = CASE WHEN ${present.has('product_url')}::boolean       THEN ${r.product_url}       ELSE product_url       END,
      updated_at        = now()
    WHERE id = ${v.id}::uuid AND client_id = ${clientId}::uuid
  `;
  updatedIds.push(v.id);
}
```

Note the `COALESCE` on `condition` and `availability` — these columns are NOT NULL, so even when the header is present and the cell is empty (parser yields null), we coerce to the DB default rather than violating the constraint. For all other Phase B columns, NULL is a legitimate cleared value.

- [ ] **Step 4: Run integration tests**

```bash
npx vitest run tests/integration/u-products-import.test.ts 2>&1 | tail -25
```

Expected: all green, including the backward-compat test (Task 6) and the two new ones from this task.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add netlify/functions/u-products-import.ts tests/integration/u-products-import.test.ts
git commit -m "feat(import): UPDATE preserves absent-header columns via CASE-WHEN dynamic SET"
```

---

### Task 9: Dry-run echoes Phase B fields

**Files:**
- Test: `tests/integration/u-products-import.test.ts`

The dry-run path already returns `validPayload` which is built from the in-memory parsed rows. The shape is unchanged. We just need to confirm Phase B fields appear in `valid[]` when present.

- [ ] **Step 1: Add a dry-run integration test**

```ts
it('dry_run includes Phase B fields in the valid[] payload', async () => {
  const csv = [
    'sku,name,type,price,gtin,condition,gst_rate',
    'D-1,Widget,physical,12.00,9999,refurbished,18',
  ].join('\n');
  const form = new FormData();
  form.append('file', new Blob([csv]), 'p.csv');
  const r = await uProductsImportHandler(
    new Request(`http://localhost/api/u-products-import?dry_run=1&client=${clientId}`, {
      method: 'POST', headers: { cookie }, body: form,
    }), CTX,
  );
  expect(r.status).toBe(200);
  const body = await r.json() as { valid: Array<{ row: number; name: string; action: string; id?: string }>; summary: { to_create: number } };
  expect(body.summary.to_create).toBe(1);
  // Dry-run does NOT write — confirm no row exists.
  const rows = await sql`SELECT id FROM public.products WHERE sku = 'D-1' AND client_id = ${clientId}::uuid` as Array<{ id: string }>;
  expect(rows).toHaveLength(0);
});
```

Notice: the current `validPayload` strips the `_row` field, so the dry-run response doesn't directly include the parsed Phase B values. That's intentional — the FE doesn't render per-field values today. Test only asserts the summary + no-write.

- [ ] **Step 2: Run, expect green (no handler changes needed)**

```bash
npx vitest run tests/integration/u-products-import.test.ts -t "dry_run includes" 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/u-products-import.test.ts
git commit -m "test(import): dry_run does not write Phase B rows"
```

---

### Task 10: Audit detail enrichment + final verification

**Files:**
- Modify: `netlify/functions/u-products-import.ts`
- Test: `tests/integration/u-products-import.test.ts` (extend an existing audit assertion if one exists; otherwise add a smoke check)

- [ ] **Step 1: Extend the audit detail payload**

Find the existing `await logAudit(...)` call at the bottom of `u-products-import.ts` (around line 193). Replace its `detail` object:

```ts
await logAudit(sql, {
  session, op: 'products.imported',
  clientId, targetType: 'product', targetId: clientId,
  detail: {
    created: createdIds.length,
    updated: updatedIds.length,
    phase_b_columns_touched: PHASE_B_HEADERS.filter((h) => parsed.present_columns.has(h)).length,
  },
});
```

Import the constant at the top of the handler:

```ts
import { parseCsvBytes, PHASE_B_HEADERS, type ParsedImportRow } from './_shared/products-import-parse';
```

- [ ] **Step 2: Add an audit assertion to one of the existing tests (or the full Phase B test)**

Add to the "imports new products with full Phase B field set" test from Task 7, after the existing assertions:

```ts
const audits = await sql`
  SELECT detail FROM public.audit_log
  WHERE client_id = ${clientId}::uuid AND op = 'products.imported'
  ORDER BY created_at DESC LIMIT 1
` as Array<{ detail: Record<string, unknown> }>;
expect(audits[0]!.detail.phase_b_columns_touched).toBe(23);
```

- [ ] **Step 3: Run the full suite**

```bash
npm test 2>&1 | tail -15
```

Expected: 488 + the new tests, all green. No regressions.

- [ ] **Step 4: Final typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/u-products-import.ts tests/integration/u-products-import.test.ts
git commit -m "feat(import): audit detail records phase_b_columns_touched count"
```

- [ ] **Step 6: Final lint/build smoke (optional but recommended)**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean.

---

## Plan-completion summary

When all 10 tasks are committed:
- 1 new constant export (`PHASE_B_HEADERS`)
- 4 new pure parser helpers
- 23 new fields on `ParsedImportRow`
- 1 new field on `ParsedImport` (`present_columns`)
- 36-column INSERT (13 original — including server-side `client_id` + `created_by_user_node` — plus 23 nullable Phase B columns)
- Dynamic per-column `CASE WHEN $present` UPDATE for the 23 Phase B columns
- 4 new fixtures (1 CSV, 1 XLSX) + 1 generator script
- ~12 new unit tests + ~6 new integration tests
- 1 audit-log enrichment

No DB migration, no FE change, no new dependency.

## Open risk to flag at PR time

- **Audit `phase_b_columns_touched` counts headers in the file, not rows actually mutated.** This is fine for the spec (a file-level count reflects the user's intent) but document it in the commit message so future readers don't expect a per-row count.
- **The Excel-serial branch in `parseTimestamp` may need adjustment** if a real-world XLSX export from Google Sheets / Excel emits a `Date` object instead of a number. Task 5 includes the `Date` branch as a defensive measure; verify against a real export at smoke time.

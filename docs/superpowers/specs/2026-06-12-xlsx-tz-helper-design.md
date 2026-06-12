# XLSX Timezone-Safe Date-Only Helper — Design

**Date:** 2026-06-12
**Module:** Shared library (used by AMS + Products XLSX import paths)
**Status:** Drafted — awaiting user review
**Related code:**
- Existing workaround: `netlify/functions/_shared/products-import-parse.ts` lines 145-184 (`parseTimestamp`).
- Existing TODO comment that this spec implements: same file, lines 148-153.

---

## 1. Goal

Provide a single, well-tested `readDateOnlyCell` helper that converts a SheetJS-emitted cell value into a canonical `YYYY-MM-DD` string without timezone drift. The helper is **import-only** — it does not write XLSX, does not handle datetimes, and does not change any existing call site in v1.

## 2. Scope

**In scope**
- New file `src/lib/xlsx-tz.ts` exporting one function `readDateOnlyCell(v: unknown)`.
- New test file `tests/unit/xlsx-tz.test.ts` with comprehensive cases.
- No call-site changes. The products import keeps using its current `parseTimestamp` until a follow-up migrates it.

**Out of scope**
- Datetime handling (date + time + timezone). Future v2 if a consumer needs it.
- Write path (export). The export pipeline writes ISO strings via the existing CSV path, so there's no current XLSX-write date-cell to harden.
- Migrating `products-import-parse.ts` to use the helper. Parallel chat owns that file; they can adopt opt-in.
- Tweaking the SheetJS `XLSX.read` options anywhere. The helper accepts whatever the caller passes — including the current `cellDates: false` default.
- Onboarding bulk import code changes. There's no date column in the AMS onboarding XLSX today; the helper is staged for future use.

## 3. Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| File location | `src/lib/xlsx-tz.ts` | Dual-context: imported by FE components AND by server-side `netlify/functions/_shared/*.ts` via relative path (existing pattern: `onboard-client-bulk.ts` imports from `src/modules/registry/products`). |
| API shape | One function returning `{ yyyymmdd, error? }` | Matches the existing `errors: FieldError[]` pattern in `products-import-parse.ts`. Caller can decide whether to push the error into their own collection or surface it differently. No throwing. |
| Output format | `YYYY-MM-DD` (date-only string) | The downstream DB column is `TIMESTAMPTZ`; the caller can append `T00:00:00Z` to get full ISO. Helper output is intentionally LESS specific than full ISO so the caller never receives a hidden TZ choice. |
| Date-component method | `getUTCFullYear` / `getUTCMonth` / `getUTCDate` | SheetJS with `cellDates: true` constructs `new Date(Date.UTC(y, m-1, d))` — UTC midnight on the wall-clock day. Using `getUTC*` returns the wall-clock day regardless of where the parser runs. Local methods (`getFullYear` etc.) would return the previous day in negative-UTC-offset timezones (e.g. America/Los_Angeles). |
| Excel serial branch | `XLSX.SSF.parse_date_code(Math.floor(v))` | Same as the existing workaround in `products-import-parse.ts`. `Math.floor` strips the fractional-day offset SheetJS adds to bare YYYY-MM-DD strings parsed from CSV in local time. |
| String YYYY-MM-DD branch | Regex `/^\d{4}-\d{2}-\d{2}$/`, pass through unchanged | No `new Date()` parse — that path silently applies the runtime's local TZ. Pass-through is timezone-immune. |
| Full ISO string branch | `new Date(s).toISOString().slice(0, 10)` | Extracts the UTC date portion. A timestamp at midnight UTC and a timestamp at 18:30 UTC on the same day both yield the same YYYY-MM-DD. Wall-clock interpretation in negative offsets MAY shift a day — accepted, since callers who pass a full ISO are opting in to ISO semantics. |
| Empty input handling | Returns `{ yyyymmdd: null }` (no error) | Empty cells are valid input — the column may be optional. Errors are reserved for malformed input. |
| Error vocabulary | `'invalid_date' \| 'invalid_serial' \| 'invalid_type'` | Three discriminable cases. Caller can render different user-facing copy if desired. |

## 4. Architecture

```
caller (e.g. products-import-parse.ts in future)
  │
  │  v: Date | number | string | null | unknown
  ▼
readDateOnlyCell(v)
  │
  ├─ null / undefined / blank string  →  { yyyymmdd: null }
  ├─ Date object                       →  zero-padded UTC components
  ├─ Number (Excel serial)             →  SSF.parse_date_code(Math.floor(v))
  ├─ String matching /^\d{4}-\d{2}-\d{2}$/  →  pass through
  ├─ Other string                      →  new Date(s).toISOString().slice(0,10)
  └─ Anything else                     →  { yyyymmdd: null, error: 'invalid_type' }
```

The helper has zero side effects, takes no options, and does not log. A pure function.

## 5. Public API

```ts
// src/lib/xlsx-tz.ts

export type XlsxDateError = 'invalid_date' | 'invalid_serial' | 'invalid_type';

export interface XlsxDateOnlyResult {
  /** Canonical YYYY-MM-DD on success; null on empty input or any error. */
  yyyymmdd: string | null;
  /** Discriminant for error cases. Absent on success or empty input. */
  error?: XlsxDateError;
}

/**
 * Read a date-only cell value from SheetJS output as canonical YYYY-MM-DD.
 *
 * Accepts the three shapes SheetJS may emit:
 *   - `Date` object (when XLSX.read is called with `cellDates: true`)
 *   - `number` (Excel serial date, when cellDates is false — the default)
 *   - `string` (YYYY-MM-DD literal from CSV, or full ISO datetime)
 *
 * Timezone behavior:
 *   - Date objects: UTC components are extracted. SheetJS constructs cells as
 *     midnight UTC on the wall-clock day. Using getUTC* returns the day the
 *     user typed regardless of the parser's local timezone.
 *   - Numbers: floored to drop any fractional-day local-TZ offset.
 *   - YYYY-MM-DD strings: passed through unchanged. No Date construction.
 *   - Full ISO strings: the UTC date portion is returned. Wall-clock semantics
 *     in negative UTC offsets may shift a day; callers passing full ISO opt
 *     into that.
 *
 * Empty input (null, undefined, blank string) returns `{ yyyymmdd: null }`
 * without an error — empty cells are valid for optional columns.
 */
export function readDateOnlyCell(v: unknown): XlsxDateOnlyResult;
```

No other exports. No helper sub-functions exposed.

## 6. Testing strategy

Single file `tests/unit/xlsx-tz.test.ts`. ~15 tests.

**Empty input (3 tests):**
- `null` → `{ yyyymmdd: null }`
- `undefined` → `{ yyyymmdd: null }`
- `''` and `'   '` → `{ yyyymmdd: null }`

**Date object branch (4 tests):**
- `new Date(Date.UTC(2026, 5, 12))` → `'2026-06-12'`
- Year boundary `new Date(Date.UTC(2026, 0, 1))` → `'2026-01-01'`
- Leap day `new Date(Date.UTC(2024, 1, 29))` → `'2024-02-29'`
- Invalid Date `new Date('not a date')` → `{ yyyymmdd: null, error: 'invalid_date' }`

**Excel serial branch (3 tests):**
- Integer serial → matches expected calendar date (compute via `XLSX.SSF.parse_date_code` in the test to avoid hard-coding magic numbers).
- Serial with fractional IST offset (e.g. `serial + 5.5/24`) → same date as the integer floor (proves Math.floor works).
- Out-of-range serial (`-1` or `1e10`) → `{ yyyymmdd: null, error: 'invalid_serial' }`

**String branch (4 tests):**
- `'2026-06-12'` → `'2026-06-12'` (pass-through)
- `'2026-06-12T00:00:00.000Z'` → `'2026-06-12'`
- `'2026-06-12T18:30:00+05:30'` (= 13:00:00 UTC) → `'2026-06-12'`
- `'not a date'` → `{ yyyymmdd: null, error: 'invalid_date' }`

**Type-guard branch (1 test):**
- `true` (boolean) → `{ yyyymmdd: null, error: 'invalid_type' }`
- Optionally: array, object — same error.

The test file uses `import * as XLSX from 'xlsx'` for the serial-fixture computation; the helper itself imports only `XLSX.SSF`.

## 7. Implementation file inventory

**New files**
- `src/lib/xlsx-tz.ts` — ~60-80 LOC.
- `tests/unit/xlsx-tz.test.ts` — ~120-150 LOC across ~15 tests.

**Modified files** — none.

## 8. Operational notes

- Zero runtime cost beyond the existing `xlsx` library which is already a production dependency.
- No new env vars.
- No new npm packages.
- Backward compatibility: nothing currently imports `xlsx-tz`. The helper is additive.
- Migration story (out of scope; for parallel chat to action when they want):
  1. Switch `XLSX.read(...)` to `cellDates: true` in `products-import-parse.ts`.
  2. Replace `parseTimestamp`'s Excel-serial + string branches with `readDateOnlyCell`.
  3. Keep `parseTimestamp` as the date-time wrapper that appends `T00:00:00Z`.

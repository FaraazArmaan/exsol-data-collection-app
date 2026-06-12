// src/lib/xlsx-tz.ts
//
// Timezone-safe date-only reader for SheetJS cell values.
//
// SheetJS emits date cells in three shapes depending on the read options
// and the source file:
//   - Date object  — when XLSX.read(..., { cellDates: true }) is used.
//   - number       — Excel serial date, when cellDates is false (the default).
//   - string       — YYYY-MM-DD literal from CSV, or a full ISO timestamp.
//
// This helper returns a canonical YYYY-MM-DD string in all three cases,
// avoiding the silent day-shift bugs that occur when the parser runs in
// a different timezone than the workbook was authored in.
//
// Spec: docs/superpowers/specs/2026-06-12-xlsx-tz-helper-design.md

import * as XLSX from 'xlsx';

export type XlsxDateError = 'invalid_date' | 'invalid_serial' | 'invalid_type';

export interface XlsxDateOnlyResult {
  /** Canonical YYYY-MM-DD on success; null on empty input or any error. */
  yyyymmdd: string | null;
  /** Discriminant for error cases. Absent on success or empty input. */
  error?: XlsxDateError;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Read a date-only cell value from SheetJS output as canonical YYYY-MM-DD.
 *
 * Empty input (null, undefined, blank string) returns { yyyymmdd: null }
 * without an error — empty cells are valid for optional columns.
 *
 * Timezone behavior:
 *   - Date objects: UTC components are extracted via getUTC* methods.
 *     SheetJS constructs cells with cellDates: true as midnight UTC on the
 *     wall-clock day, so getUTC* recovers the day regardless of the
 *     parser's local timezone.
 *   - Numbers (Excel serial): floored to drop the fractional-day local-TZ
 *     offset SheetJS adds when parsing bare YYYY-MM-DD strings from CSV.
 *   - YYYY-MM-DD strings: passed through unchanged. No Date construction.
 *   - Full ISO strings: the UTC date portion (toISOString().slice(0,10))
 *     is returned. CAUTION: a caller passing a local timestamp with a
 *     timezone offset near the day boundary will see the date shift.
 *     For example, '2026-06-12T22:00:00-08:00' (PST 10pm Jun 12 = UTC
 *     6am Jun 13) returns '2026-06-13', not '2026-06-12'. Callers that
 *     want wall-clock semantics should strip the time portion BEFORE
 *     calling this helper.
 */
export function readDateOnlyCell(v: unknown): XlsxDateOnlyResult {
  // Empty / blank
  if (v === null || v === undefined) return { yyyymmdd: null };
  if (typeof v === 'string' && v.trim() === '') return { yyyymmdd: null };

  // Date object (cellDates: true path)
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { yyyymmdd: null, error: 'invalid_date' };
    return { yyyymmdd: formatYmd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) };
  }

  // Excel serial number
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { yyyymmdd: null, error: 'invalid_serial' };
    const parts = XLSX.SSF.parse_date_code(Math.floor(v));
    if (!parts) return { yyyymmdd: null, error: 'invalid_serial' };
    return { yyyymmdd: formatYmd(parts.y, parts.m, parts.d) };
  }

  // String
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (YMD_RE.test(trimmed)) return { yyyymmdd: trimmed };
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return { yyyymmdd: null, error: 'invalid_date' };
    return { yyyymmdd: date.toISOString().slice(0, 10) };
  }

  // Anything else: boolean, object, array, function, …
  return { yyyymmdd: null, error: 'invalid_type' };
}

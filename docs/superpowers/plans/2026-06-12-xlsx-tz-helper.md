# XLSX-TZ Date-Only Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `src/lib/xlsx-tz.ts` with one public function `readDateOnlyCell(v: unknown): XlsxDateOnlyResult` that converts a SheetJS-emitted cell value to canonical `YYYY-MM-DD` without timezone drift.

**Architecture:** Pure function, zero side effects, single file. Switches on the input type — `Date` object (uses `getUTC*` methods to recover wall-clock day), `number` (Excel serial via `XLSX.SSF.parse_date_code(Math.floor(v))`), `string` (YYYY-MM-DD pass-through OR full ISO `.toISOString().slice(0,10)`). Returns a discriminated `{ yyyymmdd, error? }` shape.

**Tech Stack:** TypeScript 5, Vitest, `xlsx` (SheetJS, already in package.json). No new npm packages.

**Spec:** `docs/superpowers/specs/2026-06-12-xlsx-tz-helper-design.md` in this worktree. Read §5 (Public API) and §6 (Testing) before starting.

**Working tree:** `/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT` on branch `feat/ams-xlsx-tz-iso`. **Before every commit, run `git branch --show-current` and verify it equals `feat/ams-xlsx-tz-iso`.** Do NOT push, do NOT merge to main, do NOT `gh pr` — the parallel chat owns those.

---

## Task 1: Build `readDateOnlyCell` with full test coverage

**Files:**
- Create: `src/lib/xlsx-tz.ts`
- Create: `tests/unit/xlsx-tz.test.ts`

### Step 1: Write the failing test file

Create `tests/unit/xlsx-tz.test.ts` with the full test suite. All tests should fail with "module not found" until Step 3.

```ts
import { describe, expect, test } from 'vitest';
import * as XLSX from 'xlsx';
import { readDateOnlyCell } from '../../src/lib/xlsx-tz';

describe('readDateOnlyCell — empty input', () => {
  test('null → { yyyymmdd: null }', () => {
    expect(readDateOnlyCell(null)).toEqual({ yyyymmdd: null });
  });

  test('undefined → { yyyymmdd: null }', () => {
    expect(readDateOnlyCell(undefined)).toEqual({ yyyymmdd: null });
  });

  test('empty string → { yyyymmdd: null }', () => {
    expect(readDateOnlyCell('')).toEqual({ yyyymmdd: null });
  });

  test('whitespace-only string → { yyyymmdd: null }', () => {
    expect(readDateOnlyCell('   ')).toEqual({ yyyymmdd: null });
  });
});

describe('readDateOnlyCell — Date object (cellDates: true path)', () => {
  test('UTC-midnight Date returns wall-clock YYYY-MM-DD', () => {
    // SheetJS with cellDates: true constructs cells as midnight UTC on the
    // wall-clock day. getUTC* methods recover that day regardless of where
    // the parser runs.
    const d = new Date(Date.UTC(2026, 5, 12));   // 2026-06-12T00:00:00Z
    expect(readDateOnlyCell(d)).toEqual({ yyyymmdd: '2026-06-12' });
  });

  test('year-boundary Date zero-pads correctly', () => {
    const d = new Date(Date.UTC(2026, 0, 1));    // 2026-01-01T00:00:00Z
    expect(readDateOnlyCell(d)).toEqual({ yyyymmdd: '2026-01-01' });
  });

  test('leap day', () => {
    const d = new Date(Date.UTC(2024, 1, 29));   // 2024-02-29T00:00:00Z
    expect(readDateOnlyCell(d)).toEqual({ yyyymmdd: '2024-02-29' });
  });

  test('invalid Date (NaN time) → invalid_date', () => {
    const d = new Date('not a date');             // Invalid Date
    expect(readDateOnlyCell(d)).toEqual({ yyyymmdd: null, error: 'invalid_date' });
  });
});

describe('readDateOnlyCell — Excel serial number', () => {
  test('integer serial decodes via SSF', () => {
    // Compute the expected date from XLSX so we're not hard-coding magic numbers.
    const serial = 45820;
    const parts = XLSX.SSF.parse_date_code(serial);
    const expected = `${parts!.y}-${String(parts!.m).padStart(2, '0')}-${String(parts!.d).padStart(2, '0')}`;
    expect(readDateOnlyCell(serial)).toEqual({ yyyymmdd: expected });
  });

  test('serial with fractional IST offset (Math.floor strips it)', () => {
    const integer = 45820;
    const withOffset = integer + 5.5 / 24;       // IST offset added by SheetJS
    const parts = XLSX.SSF.parse_date_code(integer);
    const expected = `${parts!.y}-${String(parts!.m).padStart(2, '0')}-${String(parts!.d).padStart(2, '0')}`;
    expect(readDateOnlyCell(withOffset)).toEqual({ yyyymmdd: expected });
  });

  test('out-of-range serial → invalid_serial', () => {
    // XLSX.SSF.parse_date_code returns null for nonsense inputs.
    expect(readDateOnlyCell(-1)).toEqual({ yyyymmdd: null, error: 'invalid_serial' });
  });
});

describe('readDateOnlyCell — string', () => {
  test('YYYY-MM-DD literal is passed through', () => {
    expect(readDateOnlyCell('2026-06-12')).toEqual({ yyyymmdd: '2026-06-12' });
  });

  test('full ISO at midnight UTC → date portion', () => {
    expect(readDateOnlyCell('2026-06-12T00:00:00.000Z')).toEqual({ yyyymmdd: '2026-06-12' });
  });

  test('full ISO with IST offset (13:00:00Z) → same UTC date', () => {
    // 2026-06-12T18:30:00+05:30 == 2026-06-12T13:00:00Z → UTC date is the 12th.
    expect(readDateOnlyCell('2026-06-12T18:30:00+05:30')).toEqual({ yyyymmdd: '2026-06-12' });
  });

  test('garbage string → invalid_date', () => {
    expect(readDateOnlyCell('not a date')).toEqual({ yyyymmdd: null, error: 'invalid_date' });
  });
});

describe('readDateOnlyCell — type guard', () => {
  test('boolean → invalid_type', () => {
    expect(readDateOnlyCell(true)).toEqual({ yyyymmdd: null, error: 'invalid_type' });
  });

  test('object → invalid_type', () => {
    expect(readDateOnlyCell({ year: 2026 })).toEqual({ yyyymmdd: null, error: 'invalid_type' });
  });

  test('array → invalid_type', () => {
    expect(readDateOnlyCell([2026, 6, 12])).toEqual({ yyyymmdd: null, error: 'invalid_type' });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `npx vitest run tests/unit/xlsx-tz.test.ts`
Expected: every test fails with `Failed to resolve import "../../src/lib/xlsx-tz"` (module-not-found).

### Step 3: Implement the helper

Create `src/lib/xlsx-tz.ts`:

```ts
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
 *     is returned.
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
```

### Step 4: Run tests to verify they pass

Run: `npx vitest run tests/unit/xlsx-tz.test.ts`
Expected: all ~17 tests pass.

### Step 5: Typecheck

Run: `npm run typecheck`
Expected: clean exit.

### Step 6: Verify on the right branch then commit

```bash
cd "/Users/faraaz/Desktop/Faraaz Folder/Obsidian/MyBrain/ExSol/Code/Development/ExSol-Login-AMS-WT"
test "$(git branch --show-current)" = "feat/ams-xlsx-tz-iso" || { echo "WRONG BRANCH — STOP"; exit 1; }
git add src/lib/xlsx-tz.ts tests/unit/xlsx-tz.test.ts
git commit -m "feat(lib): xlsx-tz date-only cell reader

Adds src/lib/xlsx-tz.ts with one function readDateOnlyCell(v) that
returns canonical YYYY-MM-DD from any SheetJS-emitted cell shape:
Date (uses getUTC* to recover wall-clock day), number (Excel serial
via SSF.parse_date_code + Math.floor), or string (YYYY-MM-DD
pass-through or full-ISO date portion). Returns { yyyymmdd, error? }.

No call sites are migrated in this commit — the helper lives alongside
the existing parseTimestamp in products-import-parse. Migration is
opt-in per caller; see the spec's §8 for the migration story.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Every spec requirement maps to test code:
- §2 In scope (one file + one test file): Step 3 + Step 1.
- §3 API shape decision (single function returning `{ yyyymmdd, error? }`): Step 3.
- §3 Output format `YYYY-MM-DD`: Step 3 + all tests assert on this shape.
- §3 Date-component method `getUTC*`: Step 3 (Date branch) + the Date tests verify UTC-midnight inputs.
- §3 Excel serial `Math.floor`: Step 3 (number branch) + serial-with-fractional-offset test.
- §3 YYYY-MM-DD pass-through (no Date construction): Step 3 (string branch) + pass-through test.
- §3 Full ISO via `.toISOString().slice(0,10)`: Step 3 (string branch) + IST-offset string test.
- §3 Empty input behavior: Step 3 + four empty-input tests.
- §3 Error vocabulary `invalid_date | invalid_serial | invalid_type`: Step 3 type + all error-case tests.
- §6 Test inventory: matches Step 1 (~15-17 tests across 5 describe blocks).

**Placeholder scan:** No TBDs, no "add error handling," no "similar to Task N." Every line is concrete.

**Type consistency:** `readDateOnlyCell` signature, `XlsxDateOnlyResult` interface, `XlsxDateError` union — all defined once in Step 3 and consumed identically in Step 1.

**No gaps. Ready for execution.**

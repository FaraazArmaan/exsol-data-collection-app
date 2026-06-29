# Booking Module — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the database foundation and the pure-logic engine of the Booking module — the schema that makes over-booking impossible at the DB level, plus the timezone, FSM, availability, dedupe, and auto-assign logic — all unit-tested, with one integration test that proves the no-overbook guarantee.

**Architecture:** Postgres holds the truth (no `slots` table — availability is computed on-read). The no-overbook guarantee is a single `EXCLUDE USING gist` constraint, so a bare `INSERT` is atomic under concurrency. All pure logic lives in single-source modules under `src/modules/booking/lib/` (importable by both the React frontend and the Netlify functions, since functions in this repo already import across the `src/` boundary). Phase 1 ships no HTTP endpoints and no UI — those are Phases 2–3.

**Tech Stack:** Postgres (Neon, `@neondatabase/serverless` HTTP driver — **no multi-statement transactions**), TypeScript, Vitest, built-in `Intl.DateTimeFormat` for DST-safe timezone math (no date library — none is installed and we are not adding one).

## Global Constraints

- **Migrations** live in `db/migrations/NNN_*.sql`. Latest existing is `042`. Phase 1 uses `043` and `044`. Run with `npm run migrate` (applies all pending) / `npm run migrate:status`.
- **No new npm dependencies.** Timezone math uses `Intl.DateTimeFormat` only.
- **Pure logic is single-source** in `src/modules/booking/lib/`. Netlify functions import it via `../../src/modules/booking/lib/<name>`. Do NOT duplicate it into `netlify/functions/`.
- **Money is `BIGINT` cents** with a `_cents` suffix. **Timestamps are `TIMESTAMPTZ NOT NULL DEFAULT now()`.** UUID PKs default `gen_random_uuid()`.
- **Tenant scoping:** every booking table carries `bucket_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE`.
- **No-overbook predicate includes `blocked`:** the gist constraint covers `status IN ('pending','confirmed','blocked')` (blocked staff-time must occupy the slot).
- **TDD always:** write the failing test, run it red, implement minimally, run it green, commit. Each task ends green. **Every task that touches `.ts` runs `npm run typecheck` before its commit** (runtime test runs do not validate types — durable rule).
- **Strict TS:** the project enables `noUncheckedIndexedAccess`, so `array[i]`, regex-group, and `string.split()` results are `T | undefined`. Use `!` (when a prior guard proves presence) or `?? fallback`. The lib code below is already strict-clean — verified by running `npm run typecheck` (exits 0).
- **This is the Booking worktree** (`feat/booking-module-iso`). Commit locally; **never push or merge** (the parallel chat owns `main`).

---

## File Structure

```
db/migrations/
  043_booking_core.sql        # btree_gist, clients.timezone, settings, resources, time_off, services
  044_bookings.sql            # booking_status enum, bookings table, gist EXCLUDE constraint

src/modules/booking/lib/
  tz.ts                       # DST-safe tenant-local ⇄ UTC; per-day open-window computation
  dedupe.ts                   # phone normalization (E.164-ish) + customer dedupe key
  fsm.ts                      # booking status state machine (pure applyTransition)
  availability.ts             # pure slot computation from loaded DB rows
  autoassign.ts               # "Any resource" → least-busy tiebreak by id

src/modules/booking/__tests__/
  tz.test.ts
  dedupe.test.ts
  fsm.test.ts
  availability.test.ts
  autoassign.test.ts

tests/booking/
  _helpers.ts                 # seedClientWithBookingEnabled() mirror of tests/pos/_helpers.ts
  gist-overlap.test.ts        # integration: EXCLUDE constraint proof against real Postgres
```

---

## Task 1: Migration `043_booking_core.sql` — extension, tenant TZ, settings, resources, time-off, services

**Files:**
- Create: `db/migrations/043_booking_core.sql`
- Reference (style): `db/migrations/040_sales.sql`

**Interfaces:**
- Produces: tables `booking_settings`, `booking_resources`, `booking_resource_time_off`, `booking_services`; enum `booking_payment_mode`; column `clients.timezone`. Later tasks/phases consume these names.

- [ ] **Step 1: Write the migration**

```sql
-- 043_booking_core.sql — Booking module foundation (see specs/2026-06-29-booking-module-design.md §2).
-- Tenant timezone + vendor configuration tables. The bookings table + gist
-- constraint land in 044. No slots table — availability is computed on-read.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- required for EXCLUDE on (uuid =, tstzrange &&)

-- Tenant-local timezone. All grid math runs in this zone; instants stored UTC.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';

-- One settings row per tenant.
CREATE TABLE public.booking_settings (
  bucket_id          UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  slot_interval_min  INTEGER     NOT NULL DEFAULT 15  CHECK (slot_interval_min BETWEEN 5 AND 240),
  lead_time_min      INTEGER     NOT NULL DEFAULT 0   CHECK (lead_time_min >= 0),
  cancel_cutoff_min  INTEGER     NOT NULL DEFAULT 0   CHECK (cancel_cutoff_min >= 0),
  weekly_schedule    JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- { "mon": [{"open":"09:00","close":"18:00"}], ... }
  date_overrides     JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- [ {"date":"2026-08-15","closed":true} ]
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Named staff / rooms.
CREATE TABLE public.booking_resources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  weekly_schedule  JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- same shape as settings; {} = inherit tenant hours
  active           BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_resources_bucket_active_idx
  ON public.booking_resources (bucket_id, active);

-- Per-resource one-off blocks (vacation, half-day).
CREATE TABLE public.booking_resource_time_off (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id  UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE CASCADE,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX booking_time_off_resource_idx
  ON public.booking_resource_time_off (resource_id, starts_at);

-- Per-service payment behavior.
CREATE TYPE public.booking_payment_mode AS ENUM ('pay_at_venue','deposit','full_upfront');

-- Vendor service catalog.
CREATE TABLE public.booking_services (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id             UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name                  TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  duration_min          INTEGER     NOT NULL CHECK (duration_min > 0),
  price_cents           BIGINT      NOT NULL CHECK (price_cents >= 0),
  payment_mode          public.booking_payment_mode NOT NULL DEFAULT 'pay_at_venue',
  deposit_cents         BIGINT      CHECK (deposit_cents IS NULL OR deposit_cents >= 0),
  buffer_min            INTEGER     NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  active                BOOLEAN     NOT NULL DEFAULT true,
  eligible_resource_ids UUID[]      NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- deposit mode must name a deposit amount
  CHECK (payment_mode <> 'deposit' OR deposit_cents IS NOT NULL)
);
CREATE INDEX booking_services_bucket_active_idx
  ON public.booking_services (bucket_id, active);
```

- [ ] **Step 2: Apply and verify**

Run: `npm run migrate`
Expected: applies `043_booking_core` with no error; `npm run migrate:status` shows it applied.

- [ ] **Step 3: Sanity-check the schema**

Run (psql against the dev DB):
```sql
\d+ public.booking_services
SELECT extname FROM pg_extension WHERE extname = 'btree_gist';
```
Expected: table shows the `booking_payment_mode` enum column + the deposit CHECK; `btree_gist` row returned.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/043_booking_core.sql
git commit -m "feat(booking): migration 043 — tenant TZ, settings, resources, time-off, services"
```

---

## Task 2: Migration `044_bookings.sql` — bookings table + gist no-overbook constraint

**Files:**
- Create: `db/migrations/044_bookings.sql`

**Interfaces:**
- Consumes: `booking_services`, `booking_resources` (Task 1); `public.user_nodes(id)`.
- Produces: enum `booking_status`; table `bookings` with `time_range TSTZRANGE` and the `EXCLUDE USING gist` constraint. The constraint raises SQLSTATE `23P01` (`exclusion_violation`) on overlap — Phase 2's create endpoint maps that to HTTP 409.

- [ ] **Step 1: Write the migration**

```sql
-- 044_bookings.sql — the booking row + atomic no-overbook guarantee.
-- A single INSERT is atomic against the EXCLUDE constraint, so concurrent
-- bookings for the same resource+time resolve to exactly one winner (others
-- raise 23P01). This is why we don't need multi-statement transactions.

CREATE TYPE public.booking_status AS ENUM
  ('pending','confirmed','blocked','completed','cancelled','no_show');

CREATE TABLE public.bookings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id            UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  service_id           UUID        REFERENCES public.booking_services(id) ON DELETE RESTRICT,
  resource_id          UUID        NOT NULL REFERENCES public.booking_resources(id) ON DELETE RESTRICT,
  user_node_id         UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  time_range           TSTZRANGE   NOT NULL,
  status               public.booking_status NOT NULL DEFAULT 'pending',
  customer_name        TEXT,
  customer_phone       TEXT,
  customer_email       TEXT,
  price_cents          BIGINT      NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  deposit_paid_cents   BIGINT      NOT NULL DEFAULT 0 CHECK (deposit_paid_cents >= 0),
  cancellation_reason  TEXT,
  cancelled_at         TIMESTAMPTZ,
  manage_token         TEXT        UNIQUE,
  created_by_user_node UUID        REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- blocked staff-time has no customer/service; every other status requires both.
  CHECK (
    (status = 'blocked' AND service_id IS NULL AND user_node_id IS NULL)
    OR (status <> 'blocked' AND service_id IS NOT NULL AND user_node_id IS NOT NULL)
  ),
  -- one resource cannot hold two live bookings whose ranges overlap.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    time_range  WITH &&
  ) WHERE (status IN ('pending','confirmed','blocked'))
);

CREATE INDEX bookings_bucket_range_idx ON public.bookings USING gist (bucket_id, time_range);
CREATE INDEX bookings_bucket_status_idx ON public.bookings (bucket_id, status);
CREATE INDEX bookings_resource_idx ON public.bookings (resource_id, status);
CREATE INDEX bookings_user_node_idx ON public.bookings (user_node_id);
```

- [ ] **Step 2: Apply and verify**

Run: `npm run migrate`
Expected: `044_bookings` applies clean.

- [ ] **Step 3: Manually prove the constraint (throwaway)**

Run in psql (use any existing client id + a resource you insert):
```sql
-- expect the SECOND insert to fail with: ERROR ... conflicting key value violates exclusion constraint "bookings_no_overlap"
```
(Automated proof lands in Task 9 — this is just a smoke confirmation.)

- [ ] **Step 4: Commit**

```bash
git add db/migrations/044_bookings.sql
git commit -m "feat(booking): migration 044 — bookings table + gist EXCLUDE no-overbook constraint"
```

---

## Task 3: `tz.ts` — DST-safe timezone helpers

**Files:**
- Create: `src/modules/booking/lib/tz.ts`
- Test: `src/modules/booking/__tests__/tz.test.ts`

**Interfaces:**
- Produces:
  - `zonedToUtc(localWall: string, timeZone: string): Date` — `localWall` is `"2026-08-15T09:15:00"` (no zone); returns the UTC instant for that wall-clock in `timeZone`, DST-correct.
  - `utcToZonedParts(instant: Date, timeZone: string): { y:number; m:number; d:number; hh:number; mm:number; weekday:string }` — `weekday` is lowercase `'mon'|'tue'|...|'sun'`.
  - `addMinutes(instant: Date, mins: number): Date`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { zonedToUtc, utcToZonedParts, addMinutes } from '../lib/tz';

describe('zonedToUtc', () => {
  it('India has no DST: 09:15 IST → 03:45 UTC', () => {
    expect(zonedToUtc('2026-08-15T09:15:00', 'Asia/Kolkata').toISOString())
      .toBe('2026-08-15T03:45:00.000Z');
  });
  it('US Eastern in summer (EDT, -04:00): 09:00 → 13:00 UTC', () => {
    expect(zonedToUtc('2026-07-01T09:00:00', 'America/New_York').toISOString())
      .toBe('2026-07-01T13:00:00.000Z');
  });
  it('US Eastern in winter (EST, -05:00): 09:00 → 14:00 UTC', () => {
    expect(zonedToUtc('2026-01-15T09:00:00', 'America/New_York').toISOString())
      .toBe('2026-01-15T14:00:00.000Z');
  });
});

describe('utcToZonedParts', () => {
  it('maps a UTC instant to local wall-clock parts + weekday', () => {
    const p = utcToZonedParts(new Date('2026-08-15T03:45:00.000Z'), 'Asia/Kolkata');
    expect(p).toMatchObject({ y: 2026, m: 8, d: 15, hh: 9, mm: 15, weekday: 'sat' });
  });
});

describe('addMinutes', () => {
  it('adds minutes as pure instant math', () => {
    expect(addMinutes(new Date('2026-08-15T03:45:00.000Z'), 60).toISOString())
      .toBe('2026-08-15T04:45:00.000Z');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run src/modules/booking/__tests__/tz.test.ts`
Expected: FAIL — `zonedToUtc is not a function` / module not found.

- [ ] **Step 3: Implement**

```typescript
// DST-safe timezone helpers using only the built-in Intl API (no date library).
// Strategy: format a UTC guess into the target zone, measure the offset, correct once.

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function partsInZone(instant: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) map[p.type] = p.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour); // Intl can emit '24'
  return {
    y: Number(map.year), m: Number(map.month), d: Number(map.day),
    hh: hour, mm: Number(map.minute), ss: Number(map.second),
    weekday: (map.weekday ?? '').toLowerCase().slice(0, 3), // strict: noUncheckedIndexedAccess
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant: localWallAsUTC - instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - instant.getTime();
}

/** Convert a zone-naive wall-clock ("YYYY-MM-DDTHH:mm:ss") to the UTC instant in `timeZone`. */
export function zonedToUtc(localWall: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localWall);
  if (!m) throw new Error(`bad wall-clock: ${localWall}`);
  // strict: regex groups type as string|undefined under noUncheckedIndexedAccess
  const naiveUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6] : 0);
  // First guess: treat the wall-clock as if it were UTC, then subtract the zone offset.
  const guess = new Date(naiveUtc);
  const off1 = zoneOffsetMs(guess, timeZone);
  const corrected = new Date(naiveUtc - off1);
  // Re-measure once to settle DST boundaries where the offset itself shifted.
  const off2 = zoneOffsetMs(corrected, timeZone);
  return off2 === off1 ? corrected : new Date(naiveUtc - off2);
}

export function utcToZonedParts(instant: Date, timeZone: string) {
  const p = partsInZone(instant, timeZone);
  return { y: p.y, m: p.m, d: p.d, hh: p.hh, mm: p.mm, weekday: p.weekday };
}

export function addMinutes(instant: Date, mins: number): Date {
  return new Date(instant.getTime() + mins * 60_000);
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run src/modules/booking/__tests__/tz.test.ts`
Expected: PASS (all cases, incl. EDT vs EST).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/modules/booking/lib/tz.ts src/modules/booking/__tests__/tz.test.ts
git commit -m "feat(booking): DST-safe tz helpers (Intl-based, no date lib)"
```

---

## Task 4: `dedupe.ts` — phone normalization + customer dedupe key

**Files:**
- Create: `src/modules/booking/lib/dedupe.ts`
- Test: `src/modules/booking/__tests__/dedupe.test.ts`

**Interfaces:**
- Produces:
  - `normalizePhone(raw: string, defaultCountry?: string): string | null` — strips spaces/punctuation; keeps a leading `+`; assumes India (`+91`) for bare 10-digit numbers when `defaultCountry` is unset; returns `null` if it can't make a plausible E.164-ish string.
  - `dedupeKey(phone: string | null, email: string | null): string` — `${normalizedPhone}|${lowercased,trimmed email}`; used by Phase 2's match-or-create.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { normalizePhone, dedupeKey } from '../lib/dedupe';

describe('normalizePhone', () => {
  it('formats a bare Indian 10-digit number to +91', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
  });
  it('keeps an existing +country prefix', () => {
    expect(normalizePhone('+1 (415) 555-2671')).toBe('+14155552671');
  });
  it('treats 0-prefixed local numbers as national (drops the 0)', () => {
    expect(normalizePhone('098765 43210')).toBe('+919876543210');
  });
  it('returns null for junk', () => {
    expect(normalizePhone('call me')).toBeNull();
  });
});

describe('dedupeKey', () => {
  it('lowercases email and pairs with normalized phone', () => {
    expect(dedupeKey('+919876543210', '  Riya@Example.COM ')).toBe('+919876543210|riya@example.com');
  });
  it('tolerates a missing email', () => {
    expect(dedupeKey('+919876543210', null)).toBe('+919876543210|');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run src/modules/booking/__tests__/dedupe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// Phone normalization + customer dedupe key. Phone is the primary person-key;
// email is the tiebreaker (see spec §1 dedupe default).

export function normalizePhone(raw: string, defaultCountry: '+91' = '+91'): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/[^\d]/g, '');
  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, ''); // national-format leading zero
  if (digits.length === 10) return `${defaultCountry}${digits}`;   // bare local → assume default country
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function dedupeKey(phone: string | null, email: string | null): string {
  const e = (email ?? '').trim().toLowerCase();
  return `${phone ?? ''}|${e}`;
}
```

- [ ] **Step 4: Run it green** — Run: `npx vitest run src/modules/booking/__tests__/dedupe.test.ts` → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/modules/booking/lib/dedupe.ts src/modules/booking/__tests__/dedupe.test.ts
git commit -m "feat(booking): phone normalization + customer dedupe key"
```

---

## Task 5: `fsm.ts` — booking status state machine

**Files:**
- Create: `src/modules/booking/lib/fsm.ts`
- Test: `src/modules/booking/__tests__/fsm.test.ts`
- Reference (pattern): `netlify/functions/_pos-fsm.ts`

**Interfaces:**
- Produces:
  - types `BookingStatus`, `BookingAction = 'pay'|'cancel'|'complete'|'noShow'|'unblock'`.
  - `PERM: Record<BookingAction, string>` mapping each action to a permission key.
  - `applyTransition(i: { from: BookingStatus; action: BookingAction; perms: ReadonlySet<string>; now: Date; startsAt: Date; cancelCutoffMin: number; byVendor: boolean }): { ok: true; to: BookingStatus } | { ok: false; code: 'missing_perm'|'illegal_transition'|'too_late_to_cancel'|'too_early' }`.
- Mirrors POS precedence: **permission check first** (403 wins over 409).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { applyTransition } from '../lib/fsm';

const ALL = new Set(['booking.edit', 'booking.create']);
const base = {
  perms: ALL, now: new Date('2026-08-15T00:00:00Z'),
  startsAt: new Date('2026-08-16T00:00:00Z'), cancelCutoffMin: 60, byVendor: false,
};

describe('applyTransition', () => {
  it('pay: pending → confirmed', () => {
    expect(applyTransition({ ...base, from: 'pending', action: 'pay' })).toEqual({ ok: true, to: 'confirmed' });
  });
  it('complete only after the appointment window — too_early before', () => {
    const r = applyTransition({ ...base, from: 'confirmed', action: 'complete',
      now: new Date('2026-08-15T23:00:00Z') });
    expect(r).toEqual({ ok: false, code: 'too_early' });
  });
  it('customer cancel blocked past the cutoff', () => {
    const r = applyTransition({ ...base, from: 'confirmed', action: 'cancel',
      now: new Date('2026-08-15T23:30:00Z') }); // 30 min before start < 60 cutoff
    expect(r).toEqual({ ok: false, code: 'too_late_to_cancel' });
  });
  it('vendor cancel ignores the cutoff', () => {
    const r = applyTransition({ ...base, from: 'confirmed', action: 'cancel', byVendor: true,
      now: new Date('2026-08-15T23:30:00Z') });
    expect(r).toEqual({ ok: true, to: 'cancelled' });
  });
  it('illegal transition: complete from pending', () => {
    expect(applyTransition({ ...base, from: 'pending', action: 'complete',
      now: new Date('2026-08-16T01:00:00Z') })).toEqual({ ok: false, code: 'illegal_transition' });
  });
  it('missing permission beats everything (403 > 409)', () => {
    expect(applyTransition({ ...base, perms: new Set(), from: 'pending', action: 'cancel' }))
      .toEqual({ ok: false, code: 'missing_perm' });
  });
});
```

- [ ] **Step 2: Run it red** → `npx vitest run src/modules/booking/__tests__/fsm.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```typescript
export type BookingStatus =
  | 'pending' | 'confirmed' | 'blocked' | 'completed' | 'cancelled' | 'no_show';
export type BookingAction = 'pay' | 'cancel' | 'complete' | 'noShow' | 'unblock';

export const PERM: Record<BookingAction, string> = {
  pay: 'booking.create',     // payment confirmation path (public create / webhook)
  cancel: 'booking.edit',
  complete: 'booking.edit',
  noShow: 'booking.edit',
  unblock: 'booking.edit',
};

const ALLOWED_FROM: Record<BookingAction, readonly BookingStatus[]> = {
  pay: ['pending'],
  cancel: ['pending', 'confirmed'],
  complete: ['confirmed'],
  noShow: ['confirmed'],
  unblock: ['blocked'],
};
const NATURAL_TO: Record<BookingAction, BookingStatus> = {
  pay: 'confirmed', cancel: 'cancelled', complete: 'completed', noShow: 'no_show', unblock: 'blocked',
};

export type FsmError = 'missing_perm' | 'illegal_transition' | 'too_late_to_cancel' | 'too_early';

export interface TransitionInput {
  from: BookingStatus; action: BookingAction; perms: ReadonlySet<string>;
  now: Date; startsAt: Date; cancelCutoffMin: number; byVendor: boolean;
}

export function applyTransition(i: TransitionInput):
  | { ok: true; to: BookingStatus } | { ok: false; code: FsmError } {
  if (!i.perms.has(PERM[i.action])) return { ok: false, code: 'missing_perm' };
  if (!ALLOWED_FROM[i.action].includes(i.from)) return { ok: false, code: 'illegal_transition' };

  if (i.action === 'cancel' && !i.byVendor) {
    const cutoff = new Date(i.startsAt.getTime() - i.cancelCutoffMin * 60_000);
    if (i.now >= cutoff) return { ok: false, code: 'too_late_to_cancel' };
  }
  if ((i.action === 'complete' || i.action === 'noShow') && i.now < i.startsAt) {
    return { ok: false, code: 'too_early' };
  }
  return { ok: true, to: NATURAL_TO[i.action] };
}
```

- [ ] **Step 4: Run it green** → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/modules/booking/lib/fsm.ts src/modules/booking/__tests__/fsm.test.ts
git commit -m "feat(booking): status FSM with perm-precedence + cutoff/window guards"
```

> **Note for execution:** `complete`/`noShow` should really fire only after `startsAt + duration_min`. Phase 1 keeps the guard at `startsAt` (duration isn't passed into the pure FSM). Phase 3's `booking-detail` handler passes `startsAt = slotStart + duration` when calling this, satisfying the spec's "now > starts_at + duration" rule without bloating the pure function.

---

## Task 6: `autoassign.ts` — "Any resource" least-busy tiebreak

**Files:**
- Create: `src/modules/booking/lib/autoassign.ts`
- Test: `src/modules/booking/__tests__/autoassign.test.ts`

**Interfaces:**
- Produces: `pickLeastBusy(candidates: { id: string; bookingsToday: number }[]): string | null` — fewest `bookingsToday` wins; ties broken by ascending `id` (deterministic for tests); `null` if empty.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { pickLeastBusy } from '../lib/autoassign';

describe('pickLeastBusy', () => {
  it('picks the resource with the fewest bookings today', () => {
    expect(pickLeastBusy([
      { id: 'b', bookingsToday: 3 }, { id: 'a', bookingsToday: 1 }, { id: 'c', bookingsToday: 2 },
    ])).toBe('a');
  });
  it('breaks ties by ascending id', () => {
    expect(pickLeastBusy([
      { id: 'z', bookingsToday: 2 }, { id: 'a', bookingsToday: 2 },
    ])).toBe('a');
  });
  it('returns null when there are no candidates', () => {
    expect(pickLeastBusy([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it red** → FAIL.

- [ ] **Step 3: Implement**

```typescript
export function pickLeastBusy(
  candidates: { id: string; bookingsToday: number }[],
): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (x, y) => x.bookingsToday - y.bookingsToday || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  )[0]!.id;
}
```

- [ ] **Step 4: Run it green** → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/modules/booking/lib/autoassign.ts src/modules/booking/__tests__/autoassign.test.ts
git commit -m "feat(booking): least-busy auto-assign with deterministic id tiebreak"
```

---

## Task 7: `availability.ts` — pure slot computation

**Files:**
- Create: `src/modules/booking/lib/availability.ts`
- Test: `src/modules/booking/__tests__/availability.test.ts`
- Consumes: `tz.ts` (`zonedToUtc`, `addMinutes`, `utcToZonedParts`).

**Interfaces:**
- Produces:
  - types `OpenWindow = { open: string; close: string }` (`"HH:mm"`), `DaySchedule = Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', OpenWindow[]>`.
  - `Interval = { start: Date; end: Date }`.
  - `computeAvailability(input: AvailabilityInput): Slot[]` where
    `AvailabilityInput = { date: string /*YYYY-MM-DD tenant-local*/; timeZone: string; slotIntervalMin: number; leadTimeMin: number; now: Date; tenantWeekly: DaySchedule; service: { durationMin: number; bufferMin: number }; resources: { id: string; weekly: DaySchedule | null; busy: Interval[] }[] }`
    and `Slot = { startUtc: Date; endUtc: Date; resourceId: string }` (one row per free resource at each start; Phase 2 unions/filters for "any" vs named).
- Rules: a candidate `[start, start+duration+buffer)` is free for a resource iff fully inside an open window (resource weekly ∩ tenant weekly; resource `null` weekly = inherit tenant) AND no `busy` interval overlaps AND `start >= now + leadTime`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { computeAvailability, type DaySchedule } from '../lib/availability';

const weekly: DaySchedule = {
  mon: [{ open: '09:00', close: '11:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
};
const baseInput = {
  date: '2026-08-17', // a Monday
  timeZone: 'Asia/Kolkata',
  slotIntervalMin: 30,
  leadTimeMin: 0,
  now: new Date('2026-08-16T00:00:00Z'), // day before — nothing filtered by lead time
  tenantWeekly: weekly,
  service: { durationMin: 60, bufferMin: 0 },
  resources: [{ id: 'r1', weekly: null, busy: [] }],
};

describe('computeAvailability', () => {
  it('walks the open window in slot steps; last fitting 60-min start is 10:00', () => {
    const slots = computeAvailability(baseInput);
    // 09:00, 09:30, 10:00 all fit a 60-min service ending by 11:00; 10:30 would end 11:30 → excluded
    const starts = slots.map((s) => s.startUtc.toISOString());
    expect(starts).toEqual([
      '2026-08-17T03:30:00.000Z', // 09:00 IST
      '2026-08-17T04:00:00.000Z', // 09:30
      '2026-08-17T04:30:00.000Z', // 10:00
    ]);
    expect(slots.every((s) => s.resourceId === 'r1')).toBe(true);
  });

  it('excludes a start whose range overlaps a busy interval', () => {
    const slots = computeAvailability({
      ...baseInput,
      resources: [{ id: 'r1', weekly: null,
        busy: [{ start: new Date('2026-08-17T04:00:00.000Z'), end: new Date('2026-08-17T05:00:00.000Z') }] }],
    });
    // 09:00 (ends 10:00 = 04:30Z) overlaps busy 04:00–05:00 → excluded; 09:30 overlaps; 10:00 overlaps
    expect(slots).toEqual([]);
  });

  it('applies lead time relative to now', () => {
    const slots = computeAvailability({
      ...baseInput,
      now: new Date('2026-08-17T04:00:00.000Z'), // 09:30 IST
      leadTimeMin: 0,
    });
    expect(slots.map((s) => s.startUtc.toISOString())).toEqual([
      '2026-08-17T04:00:00.000Z', '2026-08-17T04:30:00.000Z',
    ]);
  });

  it('closed weekday yields no slots', () => {
    expect(computeAvailability({ ...baseInput, date: '2026-08-18' /* Tuesday, empty */ })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it red** → FAIL.

- [ ] **Step 3: Implement**

```typescript
import { zonedToUtc, addMinutes } from './tz';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type OpenWindow = { open: string; close: string };          // "HH:mm"
export type DaySchedule = Record<Weekday, OpenWindow[]>;
export type Interval = { start: Date; end: Date };
export type Slot = { startUtc: Date; endUtc: Date; resourceId: string };

export interface AvailabilityInput {
  date: string;            // YYYY-MM-DD, tenant-local
  timeZone: string;
  slotIntervalMin: number;
  leadTimeMin: number;
  now: Date;
  tenantWeekly: DaySchedule;
  service: { durationMin: number; bufferMin: number };
  resources: { id: string; weekly: DaySchedule | null; busy: Interval[] }[];
}

const ORDER: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function weekdayOf(dateYmd: string): Weekday {
  // Noon UTC avoids any date rollover; weekday of a calendar date is zone-stable enough here.
  const d = new Date(`${dateYmd}T12:00:00.000Z`);
  return ORDER[d.getUTCDay()]!;
}
function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
function intersectWindows(a: OpenWindow[], b: OpenWindow[]): OpenWindow[] {
  const out: OpenWindow[] = [];
  for (const x of a) for (const y of b) {
    const open = Math.max(hhmmToMin(x.open), hhmmToMin(y.open));
    const close = Math.min(hhmmToMin(x.close), hhmmToMin(y.close));
    if (close > open) out.push({ open: minToHHmm(open), close: minToHHmm(close) });
  }
  return out;
}
function minToHHmm(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeAvailability(input: AvailabilityInput): Slot[] {
  const wd = weekdayOf(input.date);
  const tenantWins = input.tenantWeekly[wd] ?? [];
  const earliest = addMinutes(input.now, input.leadTimeMin);
  const footprint = input.service.durationMin + input.service.bufferMin;
  const slots: Slot[] = [];

  for (const r of input.resources) {
    const resWins = r.weekly ? (r.weekly[wd] ?? []) : tenantWins;     // null weekly = inherit tenant
    const windows = r.weekly ? intersectWindows(tenantWins, resWins) : tenantWins;
    for (const w of windows) {
      const winOpen = zonedToUtc(`${input.date}T${w.open}:00`, input.timeZone);
      const winClose = zonedToUtc(`${input.date}T${w.close}:00`, input.timeZone);
      for (let start = winOpen; ; start = addMinutes(start, input.slotIntervalMin)) {
        const end = addMinutes(start, footprint);
        if (end > winClose) break;
        if (start < earliest) continue;
        const cand: Interval = { start, end };
        if (r.busy.some((b) => overlaps(cand, b))) continue;
        slots.push({ startUtc: start, endUtc: addMinutes(start, input.service.durationMin), resourceId: r.id });
      }
    }
  }
  return slots;
}
```

- [ ] **Step 4: Run it green** → PASS (all four cases).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/modules/booking/lib/availability.ts src/modules/booking/__tests__/availability.test.ts
git commit -m "feat(booking): pure availability algorithm (window intersection + overlap + lead time)"
```

---

## Task 8: `tests/booking/_helpers.ts` — integration seed helper

**Files:**
- Create: `tests/booking/_helpers.ts`
- Reference (copy + adapt): `tests/pos/_helpers.ts`

**Interfaces:**
- Produces: `seedClientWithBooking(): Promise<{ clientId: string; ownerNodeId: string; adminId: string }>` — fresh client + L1 owner + a `booking_resources` row; returns ids. Reuses the bucket-user seed shape from `tests/pos/_helpers.ts` but **does not** require module-enable rows (Phase 1 has no authz). Also `seedResource(clientId): Promise<string>` and a thin `sqlClient()` export over `neon(process.env.DATABASE_URL!)`.

- [ ] **Step 1: Write the helper** (adapt the POS helper; keep only what Phase 1 needs)

```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
export function sqlClient() { return sql; }

async function ensureBootstrapAdmin(): Promise<string> {
  // Mirror tests/pos/_helpers.ts ensureBootstrapAdmin(); copy that implementation verbatim.
  // (Returns a stable admin id used as created_by.)
  const rows = (await sql`SELECT id FROM public.admins ORDER BY created_at LIMIT 1`) as Array<{ id: string }>;
  if (rows[0]) return rows[0].id;
  const ins = (await sql`
    INSERT INTO public.admins (email, password_hash) VALUES ('boot@exsol.test', 'x') RETURNING id
  `) as Array<{ id: string }>;
  return ins[0].id;
}

export async function seedClientWithBooking() {
  const adminId = await ensureBootstrapAdmin();
  const slug = `book-test-${Math.random().toString(36).slice(2, 10)}`;
  const c = (await sql`
    INSERT INTO public.clients (slug, name, created_by) VALUES (${slug}, 'Booking Test', ${adminId})
    RETURNING id
  `) as Array<{ id: string }>;
  const clientId = c[0]!.id;
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions)
            VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)`;
  const role = (await sql`INSERT INTO public.client_roles (client_id, key, label, color)
            VALUES (${clientId}, 'owner', 'Owner', '#3b82f6') RETURNING id`) as Array<{ id: string }>;
  const node = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientId}, NULL, 1, ${role[0]!.id}, 'Owner', ${`owner-${slug}@exsol.test`}, ${adminId})
    RETURNING id`) as Array<{ id: string }>;
  return { clientId, ownerNodeId: node[0]!.id, adminId };
}

export async function seedResource(clientId: string, name = 'Sarah'): Promise<string> {
  const r = (await sql`
    INSERT INTO public.booking_resources (bucket_id, name) VALUES (${clientId}, ${name}) RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}
```

> **Execution note:** open `tests/pos/_helpers.ts` and copy its real `ensureBootstrapAdmin()` + the exact `clients`/`user_nodes`/`client_roles` column lists — the snippet above assumes the same columns the POS helper uses. If any column name differs, the POS helper is the source of truth.

- [ ] **Step 2: Commit** (no test yet — helper is exercised by Task 9)

```bash
npm run typecheck
git add tests/booking/_helpers.ts
git commit -m "test(booking): integration seed helper (client + L1 owner + resource)"
```

---

## Task 9: `gist-overlap.test.ts` — prove the no-overbook guarantee

**Files:**
- Create: `tests/booking/gist-overlap.test.ts`
- Consumes: `tests/booking/_helpers.ts` (Task 8), migrations 043–044.

**Interfaces:**
- Consumes: `seedClientWithBooking`, `seedResource`, `sqlClient`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { sqlClient, seedClientWithBooking, seedResource } from './_helpers';

const sql = sqlClient();
let clientId: string, resourceId: string, serviceId: string, nodeId: string;

beforeAll(async () => {
  const c = await seedClientWithBooking();
  clientId = c.clientId; nodeId = c.ownerNodeId;
  resourceId = await seedResource(clientId);
  const svc = (await sql`
    INSERT INTO public.booking_services (bucket_id, name, duration_min, price_cents)
    VALUES (${clientId}, 'Color', 60, 50000) RETURNING id`) as Array<{ id: string }>;
  serviceId = svc[0]!.id;
});

async function insertBooking(range: string, status = 'confirmed') {
  return sql`
    INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name)
    VALUES (${clientId}, ${serviceId}, ${resourceId}, ${nodeId}, ${range}::tstzrange, ${status}, 'X')
    RETURNING id`;
}

describe('bookings_no_overlap (gist EXCLUDE)', () => {
  it('accepts the first booking', async () => {
    const r = await insertBooking('[2026-08-17T09:00:00Z,2026-08-17T10:00:00Z)');
    expect((r as unknown[]).length).toBe(1);
  });

  it('rejects an overlapping booking on the same resource (23P01)', async () => {
    await expect(insertBooking('[2026-08-17T09:30:00Z,2026-08-17T10:30:00Z)'))
      .rejects.toMatchObject({ code: '23P01' });
  });

  it('accepts an adjacent, non-overlapping booking (touching boundary)', async () => {
    const r = await insertBooking('[2026-08-17T10:00:00Z,2026-08-17T11:00:00Z)');
    expect((r as unknown[]).length).toBe(1);
  });

  it('lets a cancelled booking overlap (outside the predicate)', async () => {
    const r = await insertBooking('[2026-08-17T09:15:00Z,2026-08-17T09:45:00Z)', 'cancelled');
    expect((r as unknown[]).length).toBe(1);
  });

  it('blocked staff-time still occupies the slot (rejects overlap)', async () => {
    await sql`
      INSERT INTO public.bookings (bucket_id, resource_id, time_range, status)
      VALUES (${clientId}, ${resourceId}, '[2026-08-18T09:00:00Z,2026-08-18T12:00:00Z)'::tstzrange, 'blocked')`;
    await expect(insertBooking('[2026-08-18T10:00:00Z,2026-08-18T11:00:00Z)'))
      .rejects.toMatchObject({ code: '23P01' });
  });
});
```

- [ ] **Step 2: Run it red** (before this point all migrations are applied, so it should actually PASS — to see it meaningfully fail first, run against a DB without 044, or trust the prior red runs). If you want a guaranteed red, temporarily assert `'00000'` for the overlap code, watch it fail, then restore `'23P01'`.

Run: `npx vitest run tests/booking/gist-overlap.test.ts`

- [ ] **Step 3: Make it green** — ensure `DATABASE_URL` points at the migrated dev DB (`npm run migrate` already ran). No production code to write; the constraint from Task 2 does the work.

Run: `npx vitest run tests/booking/gist-overlap.test.ts`
Expected: PASS — 5/5, including the `23P01` rejections and the cancelled/adjacent acceptances.

- [ ] **Step 4: Commit**

```bash
git add tests/booking/gist-overlap.test.ts
git commit -m "test(booking): prove gist EXCLUDE rejects overlap, allows adjacent/cancelled, blocks on blocked"
```

---

## Task 10: Phase-1 green sweep

**Files:** none (verification only).

- [ ] **Step 1: Full unit + integration run**

Run: `npx vitest run src/modules/booking tests/booking`
Expected: all Phase-1 suites green (tz, dedupe, fsm, autoassign, availability, gist-overlap).

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Confirm no stray files / clean tree**

Run: `git status --short`
Expected: clean (everything committed).

---

## Self-Review (against the spec)

**Spec coverage (§2 Data Model):** `clients.timezone` (T1) ✓ · `booking_settings` (T1) ✓ · `booking_resources` (T1) ✓ · `booking_resource_time_off` (T1) ✓ · `booking_services` + `payment_mode` (T1) ✓ · `bookings` + gist EXCLUDE (T2) ✓ · no-overbook proof (T9) ✓. Pure-logic engine (§3 availability, §1 dedupe/tz, §5 FSM, Q7 auto-assign): T3–T7 ✓.

**Deferred to later phases (intentional, not gaps):**
- **Customer-dedupe unique index on `user_nodes`** → Phase 2 (lands with the match-or-create upsert that defines `normalized_phone`/bucket columns).
- **`date_overrides` consumption** in availability → Phase 2 (the pure function takes resolved `tenantWeekly`; the handler subtracts overrides + time-off before calling it). `booking_resource_time_off` is fed in via `resources[].busy`.
- **Razorpay, scheduled cron, all HTTP endpoints, all UI** → Phases 2–3.

**Deviations from spec (flagged):**
- `bookings.user_node_id` and `service_id` are **nullable with a status CHECK** (spec said NOT NULL) — required for `blocked` staff-time which has no customer/service.
- The "30s in-function availability cache / Blobs version counter" is **not built** — module-level caches are banned (durable memory) and no Blobs counter exists. Availability computes on-read. Revisit only if profiling shows DB pressure.

**Type consistency:** `DaySchedule`/`OpenWindow`/`Interval` defined in `availability.ts` and reused by its tests; `BookingStatus` in `fsm.ts` matches the `booking_status` enum values in migration 044 (`pending/confirmed/blocked/completed/cancelled/no_show`); `Slot` shape consumed by Phase 2's availability endpoint.

---

## Status & Next

**Phase 1 = DB foundation + pure engine + no-overbook proof.** On green, the next plans:
- **Phase 2 — Vendor config + public booking (build-order C+D):** authz (`requireBooking`), settings/services/resources CRUD functions, customer upsert + dedupe index, public availability + create endpoints (mapping `23P01` → 409), pay-at-venue happy path.
- **Phase 3 — Payments + manage + calendar + ops (E–J):** Razorpay client + webhook + env vars, magic-link manage, vendor day-view calendar + manual/blocked booking, pending-cleanup scheduled function, nav + perms + access-levels seeding, round-trip + concurrency smoke.

# Booking Module — Phase 2: API (Vendor Config + Public Booking) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **Integration tests require migrations 043–045 applied to the DB in `DATABASE_URL` — blocked on migration-number coordination with the POS-v2 chat (memory `project_booking_migration_number_coordination`). Unit-testable tasks (3, 4) run now; DB-backed tasks wait.**

**Goal:** Ship the booking module's HTTP layer — vendor configuration/catalog CRUD (build-order C) and the public guest-booking flow to pay-at-venue confirmation (build-order D) — proven by integration tests plus a concurrency test demonstrating the no-overbook guarantee end-to-end.

**Architecture:** Flat `netlify/functions/booking-*.ts` (vendor, auth-gated by `requireBooking`) and `booking-public-*.ts` (anonymous, slug-keyed), mirroring the POS function-per-endpoint + `config.path`/`config.method` pattern. The public create path does a match-or-create customer `user_node`, then a single `INSERT` whose `gist` constraint makes over-booking impossible — `23P01` → HTTP 409. Availability reuses the Phase-1 pure `computeAvailability`, fed by DB rows with `date_overrides`/time-off subtracted in the handler.

**Tech Stack:** TypeScript, Netlify Functions v2, `@neondatabase/serverless` (no multi-statement tx), zod, vitest. Phase-1 lib (`src/modules/booking/lib/*`) imported across the `src/` boundary.

## Global Constraints
- Inherits all Phase-1 constraints (strict TS `noUncheckedIndexedAccess`; money = BIGINT cents; `npm run typecheck` before each commit; local commits only, no push/merge).
- **Routing:** flat files only; same path + different verb ⇒ separate files with `config.method`; `/api/booking/foo/:id` routes to `booking-foo.ts` NOT `booking-foo-detail.ts` — FE calls the literal function path.
- **Permissions: bucket×verb model** (decided 2026-06-30; memory `feedback_permission_keys_bucket_verb_only`). Keys: `booking.customers.{view,create,edit}` (bookings/calendar) and `booking.employees.{view,edit}` (services/resources/settings). `bookingManifest` already declares these buckets/verbs — no registry change. Action-namespaced keys are rejected by the platform validator.
- **Module gate:** `requireBooking` resolves enabled modules via `getProduct(key).modules` over `client_enabled_products` and 412s (`booking_module_not_enabled`) unless `'booking'` is reachable. Don't hardcode a product key (booking's product key ≠ module key).
- **Schema facts (verified):** `user_nodes` has `phone TEXT`, `email citext`, and UNIQUE `(client_id, lower(email))`. A node's bucket = its `role_id` → `client_roles.bucket_family`. Customer nodes have `level_number = NULL, parent_id = NULL` and a role with `bucket_family='customers'`.
- **Error precedence:** auth (401/403) > module-enabled (412) > validation (400) > conflict (409). Map Postgres `23P01` (exclusion_violation) → 409; `23505` (unique_violation) → 409.

## File Structure
```
db/migrations/
  045_booking_customer_phone_idx.sql   # (client_id, phone) lookup index for the upsert   [UNAPPLIED]

netlify/functions/
  _booking-authz.ts                    # requireBooking(req, required[])
  _booking-validators.ts               # zod bodies
  _booking-customer-upsert.ts          # match-or-create customer user_node
  booking-settings.ts                  # GET/PUT  /api/booking/settings
  booking-services.ts                  # GET/POST /api/booking/services
  booking-service-detail.ts            # GET/PATCH/DELETE /api/booking/service-detail/:id
  booking-resources.ts                 # GET/POST /api/booking/resources
  booking-resource-detail.ts           # GET/PATCH/DELETE /api/booking/resource-detail/:id
  booking-resource-time-off.ts         # GET/POST/DELETE /api/booking/resource-time-off
  booking-public-services.ts           # GET /api/booking-public/:slug/services
  booking-public-resources.ts          # GET /api/booking-public/:slug/resources
  booking-public-availability.ts       # GET /api/booking-public/:slug/availability
  booking-public-create.ts             # POST /api/booking-public/:slug/create  (23P01 → 409)

tests/booking/
  _helpers.ts (extend)  registry-perms.test.ts  authz.test.ts  validators.test.ts
  settings.test.ts  services.test.ts  resources.test.ts
  public-services.test.ts  public-availability.test.ts  public-create.test.ts  concurrency.test.ts
```

Order: **1 → 2 → 3 → 4 → (5 ∥ 6 ∥ 7) → 8 → 9 → 10 → 11 → 12 → 13.**

---

## Task 1: Migration `045_booking_customer_phone_idx.sql`

**Files:** Create `db/migrations/045_booking_customer_phone_idx.sql`.

**Interfaces:** Produces a `(client_id, phone)` index so the upsert's phone match is indexed. Email-per-tenant uniqueness already exists (015), so no unique constraint added here.

- [ ] **Step 1: Write the migration**
```sql
-- 045_booking_customer_phone_idx.sql — speed up the booking customer match-or-create
-- phone lookup. Email dedupe is already enforced by user_nodes_email_per_client_idx (015).
-- ⚠️ UNAPPLIED pending migration-number coordination (memory project_booking_migration_number_coordination).
CREATE INDEX IF NOT EXISTS user_nodes_client_phone_idx
  ON public.user_nodes (client_id, phone) WHERE phone IS NOT NULL;
```
- [ ] **Step 2: Commit (do NOT apply)**
```bash
git add db/migrations/045_booking_customer_phone_idx.sql
git commit -m "feat(booking): migration 045 — (client_id, phone) lookup index [UNAPPLIED]"
```

---

## Task 2: Registry verification (no code change)

**Files:** Create `tests/booking/registry-perms.test.ts`. Reference: `src/modules/registry/__tests__/pos-manifests.test.ts`.

- [ ] **Step 1: Write the test**
```typescript
import { describe, it, expect } from 'vitest';
import { derivePermissionRows } from '../../src/modules/registry/products';
import { isValidPermissionKey } from '../../netlify/functions/_shared/permission-keys';

describe('booking permission surfacing', () => {
  it('saloon-booking yields booking.customers + booking.employees rows', () => {
    const rows = derivePermissionRows(['saloon-booking']);
    const pairs = rows.filter((r) => r.module.key === 'booking').map((r) => r.bucket).sort();
    expect(pairs).toEqual(['customers', 'employees']);
  });
  it('booking.customers.view validates when saloon-booking is enabled', () => {
    expect(isValidPermissionKey('booking.customers.view', ['saloon-booking'])).toBe(true);
    expect(isValidPermissionKey('booking.employees.edit', ['saloon-booking'])).toBe(true);
  });
  it('action-namespaced booking keys are rejected (documents the platform gap)', () => {
    expect(isValidPermissionKey('booking.settings.edit', ['saloon-booking'])).toBe(false);
  });
});
```
- [ ] **Step 2: Run** `npx vitest run tests/booking/registry-perms.test.ts` → PASS. **Step 3: Commit** `test(booking): verify bucket×verb perms surface via registry`.

---

## Task 3: `_booking-authz.ts` — `requireBooking`

**Files:** Create `netlify/functions/_booking-authz.ts`, Test `tests/booking/authz.test.ts`. Reference: `_pos-authz.ts`.

**Interfaces:** Produces
`requireBooking(req: Request, required: readonly string[]): Promise<{ok:true; ctx:BookingAuthCtx} | {ok:false; res:Response}>` with `BookingAuthCtx = { userNodeId: string; clientId: string; perms: ReadonlySet<string> }`. Consumed by every vendor function.

- [ ] **Step 1: Write the failing test** (integration — needs DB + applied migrations + booking enabled)
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { requireBooking } from '../../netlify/functions/_booking-authz';
import { seedClientWithBooking, grantBookingPerms, bookingRequest, enableBooking } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
beforeAll(async () => { ctx = await seedClientWithBooking(); await enableBooking(ctx.clientId); });

describe('requireBooking', () => {
  it('401 when no cookie', async () => {
    const r = await requireBooking(new Request('http://x/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.res.status).toBe(401);
  });
  it('403 when authed but missing the required key', async () => {
    const r = await requireBooking(bookingRequest(ctx, 'GET', '/api/booking/settings'), ['booking.employees.edit']);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.res.status).toBe(403);
  });
  it('ok when the key is granted', async () => {
    await grantBookingPerms(ctx.clientId, 1, ['booking.employees.view']);
    const r = await requireBooking(bookingRequest(ctx, 'GET', '/api/booking/settings'), ['booking.employees.view']);
    expect(r.ok).toBe(true);
  });
});
```
- [ ] **Step 2: Run red** (will fail to import). **Step 3: Implement:**
```typescript
// Booking authorization. Mirrors _pos-authz.requirePos, but gates on the booking
// MODULE being reachable from an enabled product (booking's product key ≠ module key),
// and uses bucket×verb permission keys.
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { getProduct } from '../../src/modules/registry/products';

export interface BookingAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

export async function requireBooking(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: BookingAuthCtx } | { ok: false; res: Response }> {
  let credential: { user_node_id: string };
  let claims: { client_id: string };
  try {
    const r = await requireBucketUser(req);
    credential = r.credential;
    claims = r.claims;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, res: jsonError(401, 'unauthorized') };
    throw e;
  }

  const sql = db();
  const permRows = (await sql`
    SELECT cl.permissions
    FROM public.user_nodes un
    JOIN public.client_levels cl
      ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    WHERE un.id = ${credential.user_node_id}::uuid
    LIMIT 1
  `) as Array<{ permissions: Record<string, boolean> | null }>;
  const perms = new Set(
    Object.entries(permRows[0]?.permissions ?? {}).filter(([, v]) => v === true).map(([k]) => k),
  );

  // Module gate: is 'booking' brought in by any enabled product for this client?
  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${claims.client_id}::uuid
  `) as Array<{ product_key: string }>;
  const modules = new Set<string>();
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product) for (const ref of product.modules) modules.add(ref.module);
  }
  if (!modules.has('booking')) {
    return { ok: false, res: jsonError(412, 'booking_module_not_enabled') };
  }

  for (const r of required) {
    if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
  }
  return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms } };
}
```
- [ ] **Step 4: Run green. Step 5: `npm run typecheck` + commit** `feat(booking): requireBooking authz (module-gate + bucket×verb perms)`.

---

## Task 4: `_booking-validators.ts` — zod schemas

**Files:** Create `netlify/functions/_booking-validators.ts`, Test `tests/booking/validators.test.ts`. Reference: `_pos-validators.ts`.

**Interfaces:** Exports `SettingsPut`, `ServiceCreate`, `ServicePatch`, `ResourceCreate`, `ResourcePatch`, `TimeOffCreate`, `PublicCreateBody` (zod schemas + inferred types). Handler usage: `Schema.parse(await req.json())` in try/catch → `jsonError(400, 'invalid_body', { issues: e?.issues })`.

- [ ] **Step 1: Write the failing test** (pure — runs now)
```typescript
import { describe, it, expect } from 'vitest';
import { SettingsPut, ServiceCreate, PublicCreateBody } from '../../netlify/functions/_booking-validators';

describe('booking validators', () => {
  it('SettingsPut accepts a weekly schedule + interval', () => {
    expect(SettingsPut.parse({ slot_interval_min: 15, lead_time_min: 0, cancel_cutoff_min: 60,
      weekly_schedule: { mon: [{ open: '09:00', close: '18:00' }] }, date_overrides: [] }).slot_interval_min).toBe(15);
  });
  it('ServiceCreate requires deposit_cents when payment_mode is deposit', () => {
    expect(() => ServiceCreate.parse({ name: 'Color', duration_min: 60, price_cents: 50000,
      payment_mode: 'deposit' })).toThrow();
    expect(ServiceCreate.parse({ name: 'Color', duration_min: 60, price_cents: 50000,
      payment_mode: 'deposit', deposit_cents: 10000 }).deposit_cents).toBe(10000);
  });
  it('PublicCreateBody requires service, start, customer', () => {
    const ok = PublicCreateBody.parse({ service_id: crypto.randomUUID(), resource_id: 'any',
      start: '2026-08-17T09:00:00.000Z', customer: { name: 'Riya', phone: '98765 43210' } });
    expect(ok.resource_id).toBe('any');
  });
});
```
- [ ] **Step 2: Run red. Step 3: Implement:**
```typescript
import { z } from 'zod';

const Uuid = z.string().uuid();
const NonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be blank');
const Hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'HH:mm');
const OpenWindow = z.object({ open: Hhmm, close: Hhmm });
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WeeklySchedule = z.object(Object.fromEntries(
  WEEKDAYS.map((d) => [d, z.array(OpenWindow).optional()]),
) as Record<(typeof WEEKDAYS)[number], z.ZodOptional<z.ZodArray<typeof OpenWindow>>>).partial();
const PaymentMode = z.enum(['pay_at_venue', 'deposit', 'full_upfront']);

export const SettingsPut = z.object({
  slot_interval_min: z.number().int().min(5).max(240),
  lead_time_min: z.number().int().min(0).default(0),
  cancel_cutoff_min: z.number().int().min(0).default(0),
  weekly_schedule: WeeklySchedule.default({}),
  date_overrides: z.array(z.object({ date: z.string(), closed: z.boolean().optional() })).default([]),
});
export type SettingsPut = z.infer<typeof SettingsPut>;

export const ServiceCreate = z.object({
  name: NonBlank,
  duration_min: z.number().int().positive(),
  price_cents: z.number().int().min(0),
  payment_mode: PaymentMode.default('pay_at_venue'),
  deposit_cents: z.number().int().min(0).optional(),
  buffer_min: z.number().int().min(0).default(0),
  eligible_resource_ids: z.array(Uuid).default([]),
}).refine((s) => s.payment_mode !== 'deposit' || s.deposit_cents != null, {
  message: 'deposit_cents required when payment_mode is deposit', path: ['deposit_cents'],
});
export type ServiceCreate = z.infer<typeof ServiceCreate>;
export const ServicePatch = ServiceCreate.partial?.() ?? ServiceCreate; // note: refine() blocks .partial(); see step note

export const ResourceCreate = z.object({
  name: NonBlank,
  weekly_schedule: WeeklySchedule.default({}),
  active: z.boolean().default(true),
});
export type ResourceCreate = z.infer<typeof ResourceCreate>;
export const ResourcePatch = ResourceCreate.partial();

export const TimeOffCreate = z.object({
  resource_id: Uuid,
  starts_at: z.string(),
  ends_at: z.string(),
  reason: z.string().max(500).optional(),
});
export type TimeOffCreate = z.infer<typeof TimeOffCreate>;

export const PublicCreateBody = z.object({
  service_id: Uuid,
  resource_id: z.union([Uuid, z.literal('any')]),
  start: z.string(), // ISO UTC instant
  customer: z.object({ name: NonBlank, phone: NonBlank, email: z.string().email().optional() }),
});
export type PublicCreateBody = z.infer<typeof PublicCreateBody>;
```
> **Step note:** `z.object(...).refine(...)` returns a `ZodEffects`, which has no `.partial()`. For `ServicePatch`, define the patch as a plain `z.object({...}).partial()` of the same fields WITHOUT the refine (validate the deposit invariant in the handler instead), rather than the `?.()` shim above. Replace that one line accordingly when implementing.
- [ ] **Step 4: Run green. Step 5: typecheck + commit** `feat(booking): zod validators for settings/services/resources/public-create`.

---

## Task 5: `booking-settings.ts` — GET/PUT

**Files:** Create `netlify/functions/booking-settings.ts`, Test `tests/booking/settings.test.ts`.

**Interfaces:** GET returns the tenant's `booking_settings` row (or defaults if none); PUT upserts it. Perms: GET `booking.employees.view`, PUT `booking.employees.edit`.

- [ ] **Step 1: Failing test** (integration)
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import getPut from '../../netlify/functions/booking-settings';
import { seedClientWithBooking, enableBooking, grantBookingPerms, bookingRequest } from './_helpers';
let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
beforeAll(async () => {
  ctx = await seedClientWithBooking(); await enableBooking(ctx.clientId);
  await grantBookingPerms(ctx.clientId, 1, ['booking.employees.view', 'booking.employees.edit']);
});
describe('PUT/GET /api/booking/settings', () => {
  it('PUT upserts then GET returns it', async () => {
    const put = await getPut(bookingRequest(ctx, 'PUT', '/api/booking/settings', {
      slot_interval_min: 30, lead_time_min: 60, cancel_cutoff_min: 120,
      weekly_schedule: { mon: [{ open: '09:00', close: '17:00' }] }, date_overrides: [],
    }));
    expect(put.status).toBe(200);
    const get = await getPut(bookingRequest(ctx, 'GET', '/api/booking/settings'));
    const body = await get.json();
    expect(body.slot_interval_min).toBe(30);
    expect(body.weekly_schedule.mon[0].close).toBe('17:00');
  });
  it('PUT without edit perm → 403', async () => {
    await grantBookingPerms(ctx.clientId, 1, ['booking.employees.view']); // drop edit
    const r = await getPut(bookingRequest(ctx, 'PUT', '/api/booking/settings', { slot_interval_min: 15 }));
    expect(r.status).toBe(403);
  });
});
```
- [ ] **Step 2: Run red. Step 3: Implement:**
```typescript
// GET/PUT /api/booking/settings — tenant booking configuration (single row per bucket).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { SettingsPut } from './_booking-validators';

export const config = { path: '/api/booking/settings', method: ['GET', 'PUT'] as string[] };

const DEFAULTS = { slot_interval_min: 15, lead_time_min: 0, cancel_cutoff_min: 0,
  weekly_schedule: {}, date_overrides: [] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireBooking(req, ['booking.employees.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT slot_interval_min, lead_time_min, cancel_cutoff_min, weekly_schedule, date_overrides
      FROM public.booking_settings WHERE bucket_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    return jsonOk(rows[0] ?? DEFAULTS);
  }
  if (req.method === 'PUT') {
    const a = await requireBooking(req, ['booking.employees.edit']);
    if (!a.ok) return a.res;
    let body: SettingsPut;
    try { body = SettingsPut.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    const sql = db();
    const rows = (await sql`
      INSERT INTO public.booking_settings
        (bucket_id, slot_interval_min, lead_time_min, cancel_cutoff_min, weekly_schedule, date_overrides)
      VALUES (${a.ctx.clientId}::uuid, ${body.slot_interval_min}, ${body.lead_time_min},
              ${body.cancel_cutoff_min}, ${JSON.stringify(body.weekly_schedule)}::jsonb,
              ${JSON.stringify(body.date_overrides)}::jsonb)
      ON CONFLICT (bucket_id) DO UPDATE SET
        slot_interval_min = EXCLUDED.slot_interval_min, lead_time_min = EXCLUDED.lead_time_min,
        cancel_cutoff_min = EXCLUDED.cancel_cutoff_min, weekly_schedule = EXCLUDED.weekly_schedule,
        date_overrides = EXCLUDED.date_overrides, updated_at = now()
      RETURNING slot_interval_min, lead_time_min, cancel_cutoff_min, weekly_schedule, date_overrides
    `) as any[];
    return jsonOk(rows[0]);
  }
  return new Response('Method Not Allowed', { status: 405 });
}
```
> **Note:** verify Netlify v2 supports an array `config.method`. If not, split into `booking-settings.ts` (GET) + a `method:'PUT'` sibling per `feedback_netlify_config_path_method`. Check against the POS pattern (which used single-method files) during implementation; default to splitting if unsure.
- [ ] **Step 4: Run green. Step 5: typecheck + commit.**

---

## Task 6: `booking-services.ts` + `booking-service-detail.ts`

**Files:** Create both; Test `tests/booking/services.test.ts`. Perms: writes `booking.employees.edit`, reads `booking.employees.view`.

**Interfaces:** `booking-services.ts` GET (list active) / POST (create). `booking-service-detail.ts` GET/PATCH/DELETE `/api/booking/service-detail/:id`. Enforce the deposit-mode invariant in the handler (since `ServicePatch` drops the refine) and validate `eligible_resource_ids` belong to the tenant.

- [ ] **Step 1: Failing test** (create + list + deposit-invariant 400 + cross-tenant 404 on detail). *(Write tests mirroring `tests/pos/sale-create.test.ts` shape: seed → grant → call handler → assert status/body.)*
- [ ] **Step 2–4: Implement** `booking-services.ts`:
```typescript
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { ServiceCreate } from './_booking-validators';

export const config = { path: '/api/booking/services', method: ['GET', 'POST'] as string[] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireBooking(req, ['booking.employees.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT id, name, duration_min, price_cents, payment_mode, deposit_cents, buffer_min,
             active, eligible_resource_ids
      FROM public.booking_services WHERE bucket_id = ${a.ctx.clientId}::uuid AND active = true
      ORDER BY name`) as any[];
    return jsonOk({ services: rows });
  }
  if (req.method === 'POST') {
    const a = await requireBooking(req, ['booking.employees.edit']);
    if (!a.ok) return a.res;
    let body: import('./_booking-validators').ServiceCreate;
    try { body = ServiceCreate.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    const sql = db();
    // eligible_resource_ids must all belong to this tenant.
    if (body.eligible_resource_ids.length) {
      const owned = (await sql`
        SELECT id FROM public.booking_resources
        WHERE bucket_id = ${a.ctx.clientId}::uuid AND id = ANY(${body.eligible_resource_ids}::uuid[])
      `) as Array<{ id: string }>;
      if (owned.length !== body.eligible_resource_ids.length) return jsonError(400, 'unknown_resource');
    }
    const rows = (await sql`
      INSERT INTO public.booking_services
        (bucket_id, name, duration_min, price_cents, payment_mode, deposit_cents, buffer_min, eligible_resource_ids)
      VALUES (${a.ctx.clientId}::uuid, ${body.name}, ${body.duration_min}, ${body.price_cents},
              ${body.payment_mode}::booking_payment_mode, ${body.deposit_cents ?? null}, ${body.buffer_min},
              ${body.eligible_resource_ids}::uuid[])
      RETURNING id, name, duration_min, price_cents, payment_mode, deposit_cents, buffer_min, active, eligible_resource_ids
    `) as any[];
    return jsonOk(rows[0], { status: 201 });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
```
`booking-service-detail.ts` (GET/PATCH/DELETE; `:id` parsed from the path; PATCH re-validates the deposit invariant manually; every query is scoped `AND bucket_id = ctx.clientId` so cross-tenant → 404):
```typescript
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { ServicePatch } from './_booking-validators';

export const config = { path: '/api/booking/service-detail/:id', method: ['GET', 'PATCH', 'DELETE'] as string[] };

function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

export default async function handler(req: Request): Promise<Response> {
  const read = req.method === 'GET';
  const a = await requireBooking(req, [read ? 'booking.employees.view' : 'booking.employees.edit']);
  if (!a.ok) return a.res;
  const sql = db();
  const id = idFrom(req);

  if (req.method === 'GET') {
    const rows = (await sql`SELECT * FROM public.booking_services
      WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid LIMIT 1`) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(rows[0]);
  }
  if (req.method === 'PATCH') {
    let patch: import('./_booking-validators').ServicePatch;
    try { patch = ServicePatch.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    if (patch.payment_mode === 'deposit' && patch.deposit_cents == null) return jsonError(400, 'deposit_required');
    const rows = (await sql`
      UPDATE public.booking_services SET
        name = COALESCE(${patch.name ?? null}, name),
        duration_min = COALESCE(${patch.duration_min ?? null}, duration_min),
        price_cents = COALESCE(${patch.price_cents ?? null}, price_cents),
        payment_mode = COALESCE(${patch.payment_mode ?? null}::booking_payment_mode, payment_mode),
        deposit_cents = ${patch.deposit_cents ?? null},
        buffer_min = COALESCE(${patch.buffer_min ?? null}, buffer_min),
        active = COALESCE(${patch.active ?? null}, active)
      WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
      RETURNING *`) as any[];
    if (!rows[0]) return jsonError(404, 'not_found');
    return jsonOk(rows[0]);
  }
  // DELETE = soft-deactivate (services referenced by bookings can't be hard-deleted: ON DELETE RESTRICT).
  const rows = (await sql`UPDATE public.booking_services SET active = false
    WHERE id = ${id}::uuid AND bucket_id = ${a.ctx.clientId}::uuid RETURNING id`) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return jsonOk({ id: rows[0].id, active: false });
}
```
> `ServicePatch` = `z.object({ name, duration_min, price_cents, payment_mode, deposit_cents, buffer_min, active, eligible_resource_ids }).partial()` (no refine) — define it that way in Task 4.
- [ ] **Commit** `feat(booking): services CRUD (list/create/detail) with deposit + resource validation`.

---

## Task 7: `booking-resources.ts` + `booking-resource-detail.ts` + `booking-resource-time-off.ts`

**Files:** Create all three; Test `tests/booking/resources.test.ts`. Perms: writes `booking.employees.edit`, reads `booking.employees.view`.

**Interfaces:** Resources GET (list incl. inactive)/POST (create); resource-detail GET/PATCH/DELETE (`/api/booking/resource-detail/:id`, soft-deactivate, ON DELETE RESTRICT); time-off GET (`?resource_id=`)/POST/DELETE (`/api/booking/resource-time-off`).

- [ ] **Steps:** structurally identical to Task 6 — same `requireBooking` gate, same `bucket_id`-scoped queries, same 404-on-cross-tenant. Implement:
  - `booking-resources.ts`: GET lists `booking_resources WHERE bucket_id=ctx`; POST inserts `(bucket_id, name, weekly_schedule, active)` from `ResourceCreate` → 201.
  - `booking-resource-detail.ts`: GET/PATCH (COALESCE pattern over `name`, `weekly_schedule`, `active`)/DELETE (set `active=false`), all scoped by `bucket_id`.
  - `booking-resource-time-off.ts`: GET `?resource_id=` (verify the resource belongs to ctx first, else 404); POST from `TimeOffCreate` after asserting `resource_id` ∈ tenant + `ends_at > starts_at` (DB CHECK also enforces) → 201; DELETE `?id=` scoped via a join to the owning resource's `bucket_id`.
- [ ] **Test:** create resource → add time-off → list → delete; cross-tenant resource 404. **Commit** `feat(booking): resources + time-off CRUD`.

---

## Task 8: `_booking-customer-upsert.ts` — match-or-create customer node

**Files:** Create `netlify/functions/_booking-customer-upsert.ts`, Test `tests/booking/customer-upsert.test.ts`. Uses Phase-1 `normalizePhone` from `src/modules/booking/lib/dedupe`.

**Interfaces:** `upsertCustomer(sql, clientId, { name, phone, email }): Promise<{ userNodeId: string; wasCreated: boolean }>`. Match priority: existing customer-bucket node with same `lower(email)` OR same normalized `phone`; else create. Consumed by Task 11 + Phase-3 vendor manual-create.

> **DEPENDENCY (verify at execution):** creating a customer node needs a `client_roles` row with `bucket_family='customers'` (role_id is NOT NULL on `user_nodes`). Confirm onboarding seeds one per client; if not, this helper must `SELECT … LIMIT 1` an existing customers-bucket role and fail clearly (`no_customer_role`) when absent (a tenant that enabled booking should have one). Do NOT invent a role here without checking the onboarding seed.

- [ ] **Step 1: Failing test** (same phone twice → one node, `wasCreated` false on the 2nd; different phone → new node).
- [ ] **Step 2–4: Implement:**
```typescript
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { normalizePhone } from '../../src/modules/booking/lib/dedupe';

export async function upsertCustomer(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  customer: { name: string; phone: string; email?: string | null },
): Promise<{ userNodeId: string; wasCreated: boolean }> {
  const phone = normalizePhone(customer.phone);
  const email = customer.email?.trim().toLowerCase() ?? null;

  // Match an existing customers-bucket node by email or normalized phone.
  const existing = (await sql`
    SELECT un.id FROM public.user_nodes un
    JOIN public.client_roles cr ON cr.id = un.role_id
    WHERE un.client_id = ${clientId}::uuid AND cr.bucket_family = 'customers'
      AND ((${email}::text IS NOT NULL AND lower(un.email::text) = ${email})
        OR (${phone}::text IS NOT NULL AND un.phone = ${phone}))
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing[0]) return { userNodeId: existing[0].id, wasCreated: false };

  // Resolve a customers-bucket role for this tenant (see DEPENDENCY note).
  const role = (await sql`
    SELECT id FROM public.client_roles
    WHERE client_id = ${clientId}::uuid AND bucket_family = 'customers' LIMIT 1
  `) as Array<{ id: string }>;
  if (!role[0]) throw new Error('no_customer_role');

  const created = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, phone)
    VALUES (${clientId}::uuid, NULL, NULL, ${role[0].id}::uuid, ${customer.name}, ${email}, ${phone})
    RETURNING id
  `) as Array<{ id: string }>;
  return { userNodeId: created[0]!.id, wasCreated: true };
}
```
- [ ] **Step 5: typecheck + commit** `feat(booking): customer match-or-create upsert (email/phone, customers bucket)`.

---

## Task 9: `booking-public-services.ts` + `booking-public-resources.ts` (anonymous)

**Files:** Create both; Test `tests/booking/public-services.test.ts`. **No auth.** Slug → client lookup: `SELECT id, timezone FROM public.clients WHERE slug = $1` (public-endpoint pattern is greenfield — this is the first one).

**Interfaces:** GET `/api/booking-public/:slug/services` → active services (public fields only: id, name, duration_min, price_cents, payment_mode, deposit_cents). GET `/api/booking-public/:slug/resources` → active resources (id, name only).

- [ ] **Step 1: Failing test** (unknown slug → 404; known slug → active services only).
- [ ] **Step 2–4: Implement** (`booking-public-services.ts`):
```typescript
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';

export const config = { path: '/api/booking-public/:slug/services', method: 'GET' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/'); // .../booking-public/:slug/services
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const sql = db();
  const c = (await sql`SELECT id FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const services = (await sql`
    SELECT id, name, duration_min, price_cents, payment_mode, deposit_cents
    FROM public.booking_services WHERE bucket_id = ${c[0].id}::uuid AND active = true ORDER BY name
  `) as any[];
  return jsonOk({ services });
}
```
`booking-public-resources.ts` mirrors it (returns `id, name` from active resources). **Commit** `feat(booking): public service + resource catalogs (anonymous, slug-keyed)`.

---

## Task 10: `booking-public-availability.ts`

**Files:** Create; Test `tests/booking/public-availability.test.ts`. Consumes Phase-1 `computeAvailability`, `pickLeastBusy`.

**Interfaces:** GET `/api/booking-public/:slug/availability?service_id=&date=&resource_id=any|<id>` → `{ slots: { start, end, resource_id }[] }` (UTC ISO). Loads settings, eligible resources, time-off + existing bookings for the date window, subtracts `date_overrides` (closed dates → no slots), builds `resources[].busy`, calls `computeAvailability`, then for `any` collapses to one slot per start via `pickLeastBusy`.

- [ ] **Step 1: Failing test** (seed settings mon 09–11, one resource, one 60-min service; `date` a Monday, `resource_id=any` → starts 09:00/09:30/10:00; add a booking 09:30–10:30 → those overlapping starts drop).
- [ ] **Step 2–4: Implement:**
```typescript
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { computeAvailability, type DaySchedule, type Interval } from '../../src/modules/booking/lib/availability';
import { pickLeastBusy } from '../../src/modules/booking/lib/autoassign';

export const config = { path: '/api/booking-public/:slug/availability', method: 'GET' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/'); return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const url = new URL(req.url);
  const serviceId = url.searchParams.get('service_id') ?? '';
  const date = url.searchParams.get('date') ?? '';            // YYYY-MM-DD tenant-local
  const wantResource = url.searchParams.get('resource_id') ?? 'any';
  if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonError(400, 'invalid_query');

  const sql = db();
  const c = (await sql`SELECT id, timezone FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`)
    as Array<{ id: string; timezone: string }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const clientId = c[0].id, timeZone = c[0].timezone;

  const st = (await sql`SELECT slot_interval_min, lead_time_min, weekly_schedule, date_overrides
    FROM public.booking_settings WHERE bucket_id = ${clientId}::uuid LIMIT 1`) as any[];
  const settings = st[0] ?? { slot_interval_min: 15, lead_time_min: 0, weekly_schedule: {}, date_overrides: [] };

  // Closed-date override → no availability.
  const overrides: Array<{ date: string; closed?: boolean }> = settings.date_overrides ?? [];
  if (overrides.some((o) => o.date === date && o.closed)) return jsonOk({ slots: [] });

  const svc = (await sql`SELECT duration_min, buffer_min, eligible_resource_ids
    FROM public.booking_services WHERE id = ${serviceId}::uuid AND bucket_id = ${clientId}::uuid AND active = true LIMIT 1`) as any[];
  if (!svc[0]) return jsonError(404, 'service_not_found');

  // Eligible resources (empty eligible list = all active resources).
  const eligible: string[] = svc[0].eligible_resource_ids ?? [];
  const resourceRows = (await sql`
    SELECT id, weekly_schedule FROM public.booking_resources
    WHERE bucket_id = ${clientId}::uuid AND active = true
      AND (cardinality(${eligible}::uuid[]) = 0 OR id = ANY(${eligible}::uuid[]))
      ${wantResource === 'any' ? sql`` : sql`AND id = ${wantResource}::uuid`}
  `) as Array<{ id: string; weekly_schedule: DaySchedule }>;
  if (resourceRows.length === 0) return jsonOk({ slots: [] });

  const resIds = resourceRows.map((r) => r.id);
  // Day window in UTC is generous: pull bookings + time-off overlapping [date-1, date+2).
  const busyRows = (await sql`
    SELECT resource_id, lower(time_range) AS s, upper(time_range) AS e FROM public.bookings
    WHERE bucket_id = ${clientId}::uuid AND resource_id = ANY(${resIds}::uuid[])
      AND status IN ('pending','confirmed','blocked')
      AND time_range && tstzrange(${date}::date - 1, ${date}::date + 2)
  `) as Array<{ resource_id: string; s: string; e: string }>;
  const timeOffRows = (await sql`
    SELECT resource_id, starts_at AS s, ends_at AS e FROM public.booking_resource_time_off
    WHERE resource_id = ANY(${resIds}::uuid[])
      AND tstzrange(starts_at, ends_at) && tstzrange(${date}::date - 1, ${date}::date + 2)
  `) as Array<{ resource_id: string; s: string; e: string }>;

  const busyByResource = new Map<string, Interval[]>();
  for (const id of resIds) busyByResource.set(id, []);
  for (const r of [...busyRows, ...timeOffRows]) {
    busyByResource.get(r.resource_id)?.push({ start: new Date(r.s), end: new Date(r.e) });
  }

  const slots = computeAvailability({
    date, timeZone, slotIntervalMin: settings.slot_interval_min, leadTimeMin: settings.lead_time_min,
    now: new Date(),
    tenantWeekly: (settings.weekly_schedule ?? {}) as DaySchedule,
    service: { durationMin: svc[0].duration_min, bufferMin: svc[0].buffer_min },
    resources: resourceRows.map((r) => ({
      id: r.id, weekly: r.weekly_schedule && Object.keys(r.weekly_schedule).length ? r.weekly_schedule : null,
      busy: busyByResource.get(r.id) ?? [],
    })),
  });

  if (wantResource !== 'any') {
    return jsonOk({ slots: slots.map((s) => ({ start: s.startUtc.toISOString(), end: s.endUtc.toISOString(), resource_id: s.resourceId })) });
  }
  // "any": one slot per start, assigned to the least-busy free resource (deterministic tiebreak).
  const counts = new Map<string, number>();
  for (const b of busyRows) counts.set(b.resource_id, (counts.get(b.resource_id) ?? 0) + 1);
  const byStart = new Map<string, string[]>();
  for (const s of slots) {
    const k = s.startUtc.toISOString();
    (byStart.get(k) ?? byStart.set(k, []).get(k)!).push(s.resourceId);
  }
  const out = [...byStart.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([start, ids]) => {
    const pick = pickLeastBusy(ids.map((id) => ({ id, bookingsToday: counts.get(id) ?? 0 })))!;
    const end = slots.find((s) => s.startUtc.toISOString() === start && s.resourceId === pick)!.endUtc.toISOString();
    return { start, end, resource_id: pick };
  });
  return jsonOk({ slots: out });
}
```
> **Note:** the conditional `sql` fragment interpolation (`wantResource === 'any' ? sql`` : sql`...`) — confirm the neon tagged-template supports nested fragments; if not, branch into two full queries. The POS list endpoint avoided fragments for this reason.
- [ ] **Step 5: typecheck + commit** `feat(booking): public availability endpoint (computeAvailability + overrides/time-off + any-assign)`.

---

## Task 11: `booking-public-create.ts` — the crux

**Files:** Create; Test `tests/booking/public-create.test.ts`. Consumes `upsertCustomer`, `PublicCreateBody`, `pickLeastBusy`.

**Interfaces:** POST `/api/booking-public/:slug/create` → 201 `{ booking_id, status, manage_token, payment_intent? }`. Resolves resource (named, or auto-assign for `any`), upserts customer, single `INSERT` → `23P01`→409 `slot_taken`. `pay_at_venue` → `confirmed`; `deposit`/`full_upfront` → `pending` + `payment_intent` stub. Enforces lead-time + cutoff (public).

- [ ] **Step 1: Failing test** (happy path pay_at_venue → 201 confirmed + manage_token; second create same resource+overlap → 409 slot_taken; deposit service → 201 pending + payment_intent).
- [ ] **Step 2–4: Implement:**
```typescript
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { PublicCreateBody } from './_booking-validators';
import { upsertCustomer } from './_booking-customer-upsert';
import { pickLeastBusy } from '../../src/modules/booking/lib/autoassign';
import { randomUUID } from 'node:crypto';

export const config = { path: '/api/booking-public/:slug/create', method: 'POST' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/'); return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let body: import('./_booking-validators').PublicCreateBody;
  try { body = PublicCreateBody.parse(await req.json()); }
  catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }

  const sql = db();
  const c = (await sql`SELECT id FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const clientId = c[0].id;

  const svc = (await sql`SELECT id, duration_min, buffer_min, price_cents, payment_mode, deposit_cents, eligible_resource_ids
    FROM public.booking_services WHERE id = ${body.service_id}::uuid AND bucket_id = ${clientId}::uuid AND active = true LIMIT 1`) as any[];
  if (!svc[0]) return jsonError(404, 'service_not_found');

  const start = new Date(body.start);
  if (Number.isNaN(start.getTime())) return jsonError(400, 'invalid_start');

  // Lead-time gate (public path only).
  const st = (await sql`SELECT lead_time_min FROM public.booking_settings WHERE bucket_id = ${clientId}::uuid LIMIT 1`) as any[];
  const leadMin = st[0]?.lead_time_min ?? 0;
  if (start.getTime() < Date.now() + leadMin * 60_000) return jsonError(409, 'too_soon');

  // Resolve resource: named, or least-busy among eligible+free.
  let resourceId: string;
  if (body.resource_id !== 'any') {
    const r = (await sql`SELECT id FROM public.booking_resources
      WHERE id = ${body.resource_id}::uuid AND bucket_id = ${clientId}::uuid AND active = true LIMIT 1`) as Array<{ id: string }>;
    if (!r[0]) return jsonError(404, 'resource_not_found');
    resourceId = r[0].id;
  } else {
    const eligible: string[] = svc[0].eligible_resource_ids ?? [];
    const free = (await sql`
      SELECT br.id, (SELECT COUNT(*) FROM public.bookings b
                     WHERE b.resource_id = br.id AND b.status IN ('pending','confirmed')
                       AND b.time_range && tstzrange(${start.toISOString()}::timestamptz - interval '1 day',
                                                     ${start.toISOString()}::timestamptz + interval '1 day')) AS cnt
      FROM public.booking_resources br
      WHERE br.bucket_id = ${clientId}::uuid AND br.active = true
        AND (cardinality(${eligible}::uuid[]) = 0 OR br.id = ANY(${eligible}::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.resource_id = br.id
          AND b.status IN ('pending','confirmed','blocked')
          AND b.time_range && tstzrange(${start.toISOString()}::timestamptz,
                ${start.toISOString()}::timestamptz + make_interval(mins => ${svc[0].duration_min + svc[0].buffer_min})))
    `) as Array<{ id: string; cnt: number }>;
    const pick = pickLeastBusy(free.map((f) => ({ id: f.id, bookingsToday: Number(f.cnt) })));
    if (!pick) return jsonError(409, 'no_resource_available');
    resourceId = pick;
  }

  const { userNodeId } = await upsertCustomer(sql, clientId, body.customer);

  const isPayAtVenue = svc[0].payment_mode === 'pay_at_venue';
  const status = isPayAtVenue ? 'confirmed' : 'pending';
  const manageToken = randomUUID();
  const endIso = new Date(start.getTime() + svc[0].duration_min * 60_000).toISOString();

  try {
    const rows = (await sql`
      INSERT INTO public.bookings
        (bucket_id, service_id, resource_id, user_node_id, time_range, status,
         customer_name, customer_phone, customer_email, price_cents, manage_token)
      VALUES (${clientId}::uuid, ${svc[0].id}::uuid, ${resourceId}::uuid, ${userNodeId}::uuid,
              tstzrange(${start.toISOString()}::timestamptz, ${endIso}::timestamptz), ${status}::booking_status,
              ${body.customer.name}, ${body.customer.phone}, ${body.customer.email ?? null},
              ${svc[0].price_cents}, ${manageToken})
      RETURNING id, status
    `) as Array<{ id: string; status: string }>;
    const booking = rows[0]!;
    const payment_intent = isPayAtVenue ? undefined
      : { provider: 'razorpay', amount_cents: svc[0].payment_mode === 'deposit' ? svc[0].deposit_cents : svc[0].price_cents, status: 'stub' };
    return jsonOk({ booking_id: booking.id, status: booking.status, manage_token: manageToken, payment_intent }, { status: 201 });
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    if (code === '23P01') return jsonError(409, 'slot_taken');
    throw err;
  }
}
```
> **Razorpay note:** `payment_intent` is a stub here. Phase 3 replaces it with a real Razorpay order + the webhook that flips `pending → confirmed`. The booking row already carries `manage_token` for the magic-link manage flow (Phase 3).
- [ ] **Step 5: typecheck + commit** `feat(booking): public create — match-or-create, auto-assign, 23P01→409, payment_mode branch`.

---

## Task 12: `concurrency.test.ts` — the definitive no-overbook proof

**Files:** Create `tests/booking/concurrency.test.ts`.

- [ ] **Step 1: Write the test**
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import create from '../../netlify/functions/booking-public-create';
import { seedClientWithBooking, enableBooking, seedResource, seedCustomerRole, publicRequest, makeService, setSlug } from './_helpers';

let slug: string, serviceId: string;
beforeAll(async () => {
  const ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId); await seedCustomerRole(ctx.clientId);
  slug = await setSlug(ctx.clientId);
  const resId = await seedResource(ctx.clientId);
  serviceId = await makeService(ctx.clientId, { duration_min: 60, eligible_resource_ids: [resId] });
});

describe('no-overbook under concurrency', () => {
  it('10 parallel creates for the same slot → exactly one 201, nine 409', async () => {
    const body = (i: number) => ({ service_id: serviceId, resource_id: 'any',
      start: '2026-08-17T09:00:00.000Z', customer: { name: `C${i}`, phone: `90000000${i}` } });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => create(publicRequest(slug, 'POST', '/create', body(i)))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
  });
});
```
- [ ] **Step 2: Run** (needs DB). Expected: PASS — the gist constraint guarantees one winner. **Step 3: Commit** `test(booking): concurrency proof — 10 parallel creates → 1×201, 9×409`.

---

## Task 13: Phase-2 green sweep

- [ ] Full run: `npx vitest run tests/booking src/modules/booking` → all green. `npm run typecheck` → 0 errors. `git status --short` → clean.

---

## Self-Review (against spec §3)
- Every vendor function (settings, services±detail, resources±detail, time-off) and public function (services, resources, availability, create) present? ✓ (Tasks 5–11). *(booking-list / booking-detail / booking-manual-create are vendor calendar ops → Phase 3 with the UI.)*
- Availability reuses Phase-1 `computeAvailability` (no duplication)? ✓ (Task 10).
- `23P01 → 409` proven under real concurrency? ✓ (Task 12).
- Perm keys = bucket×verb, defined once, referenced identically? ✓ (Tasks 3–11 all use `booking.customers.*` / `booking.employees.*`).
- Deferred to Phase 3: all React UI, Razorpay gateway + webhook, magic-link manage, vendor calendar/list/detail/manual-create, pending-cleanup cron, sidebar nav.

## Open items to confirm at execution (don't fabricate)
1. **Netlify v2 array `config.method`** — if unsupported, split multi-verb files per `feedback_netlify_config_path_method`.
2. **Customers-bucket role seeding** (Task 8) — verify onboarding gives each client a `bucket_family='customers'` role; otherwise handle `no_customer_role`.
3. **Neon nested `sql` fragments** (Task 10) — if the driver rejects them, branch into two full queries.
4. **Migrations 043–045 application** — still gated on POS-v2 numbering coordination; all integration/concurrency tests are red until applied.

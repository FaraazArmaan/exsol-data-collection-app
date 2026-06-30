# Analytics Module — Framework + Sales Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Analytics Module's pluggable framework end-to-end and prove it with the complete Sales domain (KPIs, trend, breakdowns, scoping, export, dashboard).

**Architecture:** A read-only module that owns no tables. Per-domain Netlify functions run live `GROUP BY` aggregation over existing operational tables, gated by `analytics.<bucket>.view` (bucket×verb) and subtree-scoped via the existing `subtreeOf` CTE. Frontend is a self-assembling dashboard rendering domain manifests with Recharts.

**Tech Stack:** TypeScript, Netlify Functions v2, Neon (`@neondatabase/serverless` tagged-template SQL), React + react-router, Recharts, Vitest, Zod.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-30-analytics-module-design.md` (read it first).
- Branch/worktree: `feat/analytics-module-iso` · `../ExSol-Analytics-WT`. **No `git push`, no merge to `main`.**
- **Zero migrations** — analytics owns no schema; permission keys live in `client_levels.permissions` JSONB.
- Permission keys are `<module>.<bucket>.<verb>` only (no action-namespacing) so they validate + render in the access-level UI.
- Money is stored and returned as integer **cents** (`*_cents`, `BIGINT`); formatting is frontend-only.
- Day/week/month bucketing MUST use `AT TIME ZONE :tenant_tz` (never raw UTC).
- SQL is always parameterised via the tagged template; never string-concatenate values.
- `requirePermission` / L1 bypass: admin sessions and `level_number === 1` bypass the matrix and are treated as **root scope**.
- Run `npm run typecheck` before every commit (runtime/tsx does not validate TS).
- Tests share a persistent dev DB with no teardown: randomise unique literals, use distinct time ranges, run the FULL suite before declaring green.
- Multi-worktree `netlify dev`: pass both `--port` and `--target-port` to avoid the vite 5173 collision with the sibling chat.

---

## File Structure

**Backend (netlify/functions/):**
- `_analytics-authz.ts` — `resolveAnalyticsAccess(req)`: permission + scope resolver shared by all endpoints.
- `_analytics-sql.ts` — pure helpers: `compareWindow`, `dayBucketExpr`, `pctDelta`.
- `_analytics-validators.ts` — Zod query schema (`AnalyticsQuery`).
- `analytics-sales.ts` — Sales domain endpoint (KPIs + series + breakdowns).
- `analytics-overview.ts` — headline scorecard across permitted buckets.
- `analytics-sales-export.ts` — XLSX/CSV export of the Sales view.

**Registry (src/modules/registry/):**
- `manifests/analytics.ts` — `analyticsManifest` (buckets, `verbs:['view']`).
- `modules.ts` — add one registry line.

**Frontend (src/modules/analytics/):**
- `api.ts` — typed client.
- `types.ts` — shared response types.
- `components/KpiTile.tsx`, `TrendChart.tsx`, `BarChart.tsx`, `DonutChart.tsx`, `DomainPanel.tsx`, `FilterBar.tsx`, `AnalyticsDashboard.tsx`.
- `AnalyticsRouteMount.tsx` — route element.

**Shared FE edits:**
- `src/modules/user-portal/nav/useNavItems.ts` — add `analytics` to dedicated-nav set.
- Sidebar + route table — mount `/c/:slug/analytics`.

**Tests:** `tests/analytics/*.test.ts` (backend) and `src/modules/analytics/__tests__/*` (components).

---

## Task 1: Analytics manifest + registry wiring

**Files:**
- Create: `src/modules/registry/manifests/analytics.ts`
- Modify: `src/modules/registry/modules.ts`
- Test: `src/modules/registry/__tests__/analytics-manifest.test.ts`

**Interfaces:**
- Consumes: `ModuleManifest` from `../types`.
- Produces: `analyticsManifest`; `moduleRegistry.analytics`. Permission keys `analytics.business.view`, `analytics.customers.view`, `analytics.employees.view`, `analytics.products.view` become valid (derived from manifest buckets × verbs).

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/registry/__tests__/analytics-manifest.test.ts
import { describe, it, expect } from 'vitest';
import { getModule } from '../modules';
import { isValidPermissionKey } from '../types';

describe('analytics manifest', () => {
  it('is registered with view-only verbs over four buckets', () => {
    const m = getModule('analytics');
    expect(m).toBeDefined();
    expect(m!.verbs).toEqual(['view']);
    expect([...m!.data_buckets].sort()).toEqual(
      ['business', 'customers', 'employees', 'products'].sort(),
    );
  });

  it('validates analytics.<bucket>.view keys', () => {
    expect(isValidPermissionKey('analytics.business.view')).toBe(true);
    expect(isValidPermissionKey('analytics.products.view')).toBe(true);
    // create/edit/delete are not declared → invalid
    expect(isValidPermissionKey('analytics.business.edit')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/registry/__tests__/analytics-manifest.test.ts`
Expected: FAIL — `getModule('analytics')` is undefined.

> If `isValidPermissionKey` does not exist in `../types`, grep for the actual validator name (`grep -rn "PermissionKey" src/modules/registry/types.ts`) and adjust the import + assertions to the real exported function. Do not invent it.

- [ ] **Step 3: Create the manifest**

```ts
// src/modules/registry/manifests/analytics.ts
import type { ModuleManifest } from '../types';

// Analytics is a read-only cross-module projection. It declares all four data
// buckets so each `analytics.<bucket>.view` key validates + renders in the
// access-level UI, but only the `view` verb — create/edit/delete are meaningless
// for a read projection.
export const analyticsManifest: ModuleManifest = {
  key: 'analytics',
  label: 'Analytics',
  data_buckets: ['business', 'customers', 'employees', 'products'],
  verbs: ['view'],
  vendor_side: true,
  customer_side: false,
};
```

- [ ] **Step 4: Wire it into the registry**

```ts
// src/modules/registry/modules.ts — add import + registry entry
import { analyticsManifest } from './manifests/analytics';
// ...
export const moduleRegistry = {
  booking: bookingManifest,
  payments: paymentsManifest,
  products: productsManifest,
  pos: posManifest,
  analytics: analyticsManifest,
} as const satisfies Record<string, ModuleManifest>;
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/modules/registry/__tests__/analytics-manifest.test.ts && npm run typecheck`
Expected: PASS, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/registry/manifests/analytics.ts src/modules/registry/modules.ts src/modules/registry/__tests__/analytics-manifest.test.ts
git commit -m "feat(analytics): register Analytics module manifest (view-only, 4 buckets)"
```

---

## Task 2: `_analytics-sql.ts` pure helpers

**Files:**
- Create: `netlify/functions/_analytics-sql.ts`
- Test: `tests/analytics/sql-helpers.test.ts`

**Interfaces:**
- Produces:
  - `compareWindow(from: string, to: string, mode: 'prior_period'|'prior_year'|'none'): { from: string; to: string } | null` — `from`/`to` are `YYYY-MM-DD`; `to` is exclusive-day-after handled by the caller. Returns `null` for `'none'`.
  - `pctDelta(current: number, prior: number): number | null` — percent change, `null` when prior is 0.

- [ ] **Step 1: Write the failing test**

```ts
// tests/analytics/sql-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { compareWindow, pctDelta } from '../../netlify/functions/_analytics-sql';

describe('compareWindow', () => {
  it('prior_period returns the immediately preceding equal-length window', () => {
    // 2026-06-08..2026-06-14 inclusive = 7 days → prior = 2026-06-01..2026-06-07
    expect(compareWindow('2026-06-08', '2026-06-14', 'prior_period')).toEqual({
      from: '2026-06-01', to: '2026-06-07',
    });
  });
  it('prior_year shifts back exactly one year', () => {
    expect(compareWindow('2026-06-08', '2026-06-14', 'prior_year')).toEqual({
      from: '2025-06-08', to: '2025-06-14',
    });
  });
  it('none returns null', () => {
    expect(compareWindow('2026-06-08', '2026-06-14', 'none')).toBeNull();
  });
});

describe('pctDelta', () => {
  it('computes percent change', () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(50, 100)).toBe(-50);
  });
  it('returns null when prior is zero (no baseline)', () => {
    expect(pctDelta(100, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/sql-helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
// netlify/functions/_analytics-sql.ts
//
// Pure date-window + delta math for analytics endpoints. No DB access here so
// it stays unit-testable. The tz-aware day bucket lives in SQL (see endpoints):
//   date_trunc('day', created_at AT TIME ZONE $tz)

export type CompareMode = 'prior_period' | 'prior_year' | 'none';

// Parse a YYYY-MM-DD into a UTC-midnight Date (no tz drift for pure date math).
function parseDay(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
}
function fmtDay(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
const MS_PER_DAY = 86_400_000;

export function compareWindow(
  from: string,
  to: string,
  mode: CompareMode,
): { from: string; to: string } | null {
  if (mode === 'none') return null;
  const f = parseDay(from);
  const t = parseDay(to);
  if (mode === 'prior_year') {
    const pf = new Date(Date.UTC(f.getUTCFullYear() - 1, f.getUTCMonth(), f.getUTCDate()));
    const pt = new Date(Date.UTC(t.getUTCFullYear() - 1, t.getUTCMonth(), t.getUTCDate()));
    return { from: fmtDay(pf), to: fmtDay(pt) };
  }
  // prior_period — equal-length window immediately before [from, to].
  const lenDays = Math.round((t.getTime() - f.getTime()) / MS_PER_DAY) + 1; // inclusive
  const pt = new Date(f.getTime() - MS_PER_DAY);
  const pf = new Date(pt.getTime() - (lenDays - 1) * MS_PER_DAY);
  return { from: fmtDay(pf), to: fmtDay(pt) };
}

export function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/analytics/sql-helpers.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_analytics-sql.ts tests/analytics/sql-helpers.test.ts
git commit -m "feat(analytics): add compareWindow + pctDelta pure helpers"
```

---

## Task 3: `_analytics-authz.ts` permission + scope resolver

**Files:**
- Create: `netlify/functions/_analytics-authz.ts`
- Test: `tests/analytics/authz-scope.test.ts`

**Interfaces:**
- Consumes: `requirePermission`, `UnauthorizedError`, `ForbiddenError` from `_shared/permissions`; `subtreeOf` from `_shared/subtree`; `db` from `_shared/db`; `jsonError` from `_shared/http`.
- Produces:
  ```ts
  type Bucket = 'business' | 'customers' | 'employees' | 'products';
  interface AnalyticsAccess {
    clientId: string;
    userNodeId: string | null;   // null for admin sessions
    isRootScope: boolean;        // admin OR level_number === 1
    scopeNodes: string[] | null; // null when root scope (no node filter); else subtree ids
    buckets: Set<Bucket>;        // which analytics.<bucket>.view the caller holds
  }
  async function resolveAnalyticsAccess(req: Request, requiredBucket?: Bucket):
    Promise<{ ok: true; access: AnalyticsAccess } | { ok: false; res: Response }>;
  ```
  - When `requiredBucket` is given and the caller lacks it → `403 forbidden`.
  - `scopeNodes`: if a `?node=<uuid>` param is present and within the caller's subtree, scope to `subtreeOf(node)`; otherwise the caller's own subtree. Root scope ⇒ `null` (see-all).

- [ ] **Step 1: Write the failing test**

```ts
// tests/analytics/authz-scope.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { resolveAnalyticsAccess } from '../../netlify/functions/_analytics-authz';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;

beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  await grantPerms(ctx.clientId, 1, []); // L1 owner — bypasses matrix anyway
});

describe('resolveAnalyticsAccess', () => {
  it('L1 owner is root scope with all four buckets', async () => {
    const r = await resolveAnalyticsAccess(makeBucketUserRequest(ctx, 'GET', '/api/analytics-sales'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.access.isRootScope).toBe(true);
    expect(r.access.scopeNodes).toBeNull();
    expect(r.access.buckets.has('business')).toBe(true);
  });

  it('L2 with only analytics.business.view is subtree-scoped and lacks other buckets', async () => {
    const sub = await seedSubordinateUser(ctx, 2, ['analytics.business.view']);
    const r = await resolveAnalyticsAccess(
      makeBucketUserRequest(sub, 'GET', '/api/analytics-sales'), 'business');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.access.isRootScope).toBe(false);
    expect(r.access.scopeNodes).toContain(sub.userNodeId);
    expect(r.access.buckets.has('business')).toBe(true);
    expect(r.access.buckets.has('customers')).toBe(false);
  });

  it('L2 lacking the required bucket is forbidden', async () => {
    const sub = await seedSubordinateUser(ctx, 3, []); // no analytics keys
    const r = await resolveAnalyticsAccess(
      makeBucketUserRequest(sub, 'GET', '/api/analytics-sales'), 'business');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/authz-scope.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

```ts
// netlify/functions/_analytics-authz.ts
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { subtreeOf } from './_shared/subtree';
import {
  requirePermission, getLevelMatrix, UnauthorizedError, ForbiddenError,
  type AnySession,
} from './_shared/permissions';

export type Bucket = 'business' | 'customers' | 'employees' | 'products';
const ALL_BUCKETS: Bucket[] = ['business', 'customers', 'employees', 'products'];

export interface AnalyticsAccess {
  clientId: string;
  userNodeId: string | null;
  isRootScope: boolean;
  scopeNodes: string[] | null;
  buckets: Set<Bucket>;
}

// We call requirePermission with a throwaway key only to authenticate + classify
// the session; bucket entitlements are resolved from the matrix ourselves so the
// overview endpoint can return a partial dashboard. requirePermission's L1/admin
// bypass means owners always pass regardless of the probe key.
export async function resolveAnalyticsAccess(
  req: Request,
  requiredBucket?: Bucket,
): Promise<{ ok: true; access: AnalyticsAccess } | { ok: false; res: Response }> {
  let session: AnySession;
  try {
    // Probe with the required bucket if given (so a non-owner missing it 403s here);
    // otherwise probe business — owners bypass, non-owners get re-checked below.
    session = await requirePermission(req, `analytics.${requiredBucket ?? 'business'}.view`);
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, res: jsonError(401, 'unauthorized') };
    if (e instanceof ForbiddenError) return { ok: false, res: jsonError(403, 'forbidden') };
    throw e;
  }

  const sql = db();

  if (session.kind === 'admin') {
    // Admins act on a client via ?client=; require it.
    const clientId = new URL(req.url).searchParams.get('client');
    if (!clientId) return { ok: false, res: jsonError(400, 'missing_client') };
    return {
      ok: true,
      access: { clientId, userNodeId: null, isRootScope: true, scopeNodes: null,
                buckets: new Set(ALL_BUCKETS) },
    };
  }

  const isRoot = session.level_number === 1;
  const clientId = session.client_id;

  // Entitled buckets: owner = all; else read from matrix.
  let buckets: Set<Bucket>;
  if (isRoot) {
    buckets = new Set(ALL_BUCKETS);
  } else {
    const matrix = await getLevelMatrix(clientId, session.level_number);
    buckets = new Set(ALL_BUCKETS.filter((b) => matrix[`analytics.${b}.view`]));
    if (requiredBucket && !buckets.has(requiredBucket)) {
      return { ok: false, res: jsonError(403, 'forbidden') };
    }
  }

  // Scope. Root → no node filter. Else subtree of (?node within own subtree) or self.
  let scopeNodes: string[] | null = null;
  if (!isRoot) {
    const ownSubtree = await subtreeOf(sql, session.user_node_id);
    const requested = new URL(req.url).searchParams.get('node');
    if (requested && requested !== session.user_node_id) {
      if (!ownSubtree.includes(requested)) {
        return { ok: false, res: jsonError(403, 'forbidden_subtree') };
      }
      scopeNodes = await subtreeOf(sql, requested);
    } else {
      scopeNodes = ownSubtree;
    }
  }

  return {
    ok: true,
    access: { clientId, userNodeId: session.user_node_id, isRootScope: isRoot, scopeNodes, buckets },
  };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/analytics/authz-scope.test.ts && npm run typecheck`
Expected: PASS. If `seedClientWithProductsEnabled` does not also enable analytics for the client and a test needs the module enabled, note that analytics has **no enable-gate** (it is permission-only) so no enable step is required here.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_analytics-authz.ts tests/analytics/authz-scope.test.ts
git commit -m "feat(analytics): permission + subtree-scope resolver (root vs subtree, bucket entitlements)"
```

---

## Task 4: `_analytics-validators.ts` query schema

**Files:**
- Create: `netlify/functions/_analytics-validators.ts`
- Test: `tests/analytics/validators.test.ts`

**Interfaces:**
- Produces: `AnalyticsQuery` (Zod schema) parsing `{ from, to, compare, granularity, node?, client? }`. Defaults: `from`/`to` = today (tenant-agnostic ISO date), `compare='none'`, `granularity='day'`. `from`/`to` must be `YYYY-MM-DD`; `compare ∈ {prior_period,prior_year,none}`; `granularity ∈ {day,week,month}`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/analytics/validators.test.ts
import { describe, it, expect } from 'vitest';
import { AnalyticsQuery } from '../../netlify/functions/_analytics-validators';

describe('AnalyticsQuery', () => {
  it('parses a full query', () => {
    const q = AnalyticsQuery.parse({
      from: '2026-06-01', to: '2026-06-30', compare: 'prior_period', granularity: 'week',
    });
    expect(q.granularity).toBe('week');
  });
  it('defaults compare and granularity', () => {
    const q = AnalyticsQuery.parse({ from: '2026-06-01', to: '2026-06-30' });
    expect(q.compare).toBe('none');
    expect(q.granularity).toBe('day');
  });
  it('rejects a bad date', () => {
    expect(() => AnalyticsQuery.parse({ from: '06/01/2026', to: '2026-06-30' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/validators.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the schema**

```ts
// netlify/functions/_analytics-validators.ts
import { z } from 'zod';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const AnalyticsQuery = z.object({
  from: isoDay,
  to: isoDay,
  compare: z.enum(['prior_period', 'prior_year', 'none']).default('none'),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  node: z.string().uuid().optional(),
  client: z.string().uuid().optional(),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/analytics/validators.test.ts && npm run typecheck`
Expected: PASS. (Confirm `zod` is the validation lib used by `_pos-validators.ts`; if a different version/import style is used there, match it.)

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_analytics-validators.ts tests/analytics/validators.test.ts
git commit -m "feat(analytics): AnalyticsQuery zod schema (date range, compare, granularity)"
```

---

## Task 5: `analytics-sales.ts` — KPIs (revenue, sales, AOV) with scope + compare

**Files:**
- Create: `netlify/functions/analytics-sales.ts`
- Test: `tests/analytics/sales-kpis.test.ts`

**Interfaces:**
- Consumes: `resolveAnalyticsAccess`, `AnalyticsQuery`, `compareWindow`, `pctDelta`, `db`, `jsonOk`, `jsonError`.
- Produces: `GET /api/analytics-sales` →
  ```ts
  {
    scope: { isRootScope: boolean; nodeCount: number };
    kpis: Array<{ id: 'revenue'|'sales'|'aov'; label: string; value: number; unit: 'cents'|'count'; delta: number|null; deltaPct: number|null }>;
    series: Array<{ id: string; chart: 'line'|'bar'; points: Array<{ x: string; y: number }> }>;     // filled in Task 6
    breakdowns: Array<{ id: string; label: string; rows: Array<{ key: string; value: number; pct: number }> }>; // Task 6
    generatedAt: string;
  }
  ```
- Revenue counts only `status IN ('paid','fulfilled')`. Subtree filter on `created_by_user_node`. Storefront rows (`source='storefront'`) included **only when `isRootScope`**.

- [ ] **Step 1: Write the failing test**

```ts
// tests/analytics/sales-kpis.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-sales';
import createHandler from '../../netlify/functions/pos-sale-create';
import markPaid from '../../netlify/functions/pos-sale-state';
import {
  seedClientWithProductsEnabled, seedProducts, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
let productId: string;

// Use a fixed historical window so re-runs on the shared dev DB don't collide
// with "today" data from other suites.
const FROM = '2026-03-02';
const TO = '2026-03-02';

beforeAll(async () => {
  ctx = await seedClientWithProductsEnabled();
  const ids = await seedProducts(ctx.clientId, [
    { name: `A-${Math.random().toString(36).slice(2, 7)}`, sale_price_cents: 1000, pos_visible: true, status: 'active' },
  ]);
  productId = ids[0]!;
  await grantPerms(ctx.clientId, 1, ['pos.sale.create', 'pos.sale.markPaid', 'analytics.business.view']);
  // Two paid sales of 1000 cents each, back-dated into the FROM window.
  for (let i = 0; i < 2; i++) {
    const c = await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'instore', idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: `9${i}` }, lines: [{ productId, qty: 1 }],
    }));
    expect(c.status).toBe(201);
    const sale = await c.json();
    // mark paid (transition) — see pos-sale-state contract
    await markPaid(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sale.id}/state`, { action: 'markPaid' }));
    // back-date so it lands in the fixed window
    await backdateSale(sale.id, `${FROM}T10:00:00Z`);
  }
});

describe('GET /api/analytics-sales KPIs', () => {
  it('owner sees revenue + sales + AOV for the window', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const revenue = body.kpis.find((k: any) => k.id === 'revenue');
    const sales = body.kpis.find((k: any) => k.id === 'sales');
    const aov = body.kpis.find((k: any) => k.id === 'aov');
    expect(revenue.value).toBe(2000);
    expect(sales.value).toBe(2);
    expect(aov.value).toBe(1000);
    expect(body.scope.isRootScope).toBe(true);
  });

  it('subordinate with no sales of their own sees zero revenue (subtree scoping)', async () => {
    const sub = await seedSubordinateUser(ctx, 2, ['analytics.business.view']);
    const res = await handler(makeBucketUserRequest(sub, 'GET', `/api/analytics-sales?from=${FROM}&to=${TO}`));
    const body = await res.json();
    expect(body.kpis.find((k: any) => k.id === 'revenue').value).toBe(0);
    expect(body.scope.isRootScope).toBe(false);
  });
});

// Helper: directly back-date a sale's created_at for deterministic windowing.
async function backdateSale(id: string, iso: string) {
  const { db } = await import('../../netlify/functions/_shared/db');
  await db()`UPDATE public.sales SET created_at = ${iso}::timestamptz WHERE id = ${id}::uuid`;
}
```

> Before writing implementation, confirm the real `pos-sale-state` request contract (path + body) by reading `netlify/functions/pos-sale-state.ts`; adjust the seed transition call to match. If marking paid is awkward in tests, instead back-date AND set `status='paid', paid_at` directly via the same `db()` escape hatch used by `backdateSale`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/sales-kpis.test.ts`
Expected: FAIL — `analytics-sales` module not found.

- [ ] **Step 3: Implement the endpoint (KPIs only for now)**

```ts
// netlify/functions/analytics-sales.ts
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';
import { compareWindow, pctDelta } from './_analytics-sql';

export const config = { path: '/api/analytics-sales', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const auth = await resolveAnalyticsAccess(req, 'business');
  if (!auth.ok) return auth.res;
  const { clientId, isRootScope, scopeNodes } = auth.access;

  let q: AnalyticsQuery;
  try {
    q = AnalyticsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const nodes: string[] = scopeNodes ?? [];
  const noNodeFilter = scopeNodes === null; // root scope: see all
  // Storefront rows have created_by_user_node IS NULL; include them ONLY at root scope.

  async function windowKpis(from: string, to: string) {
    const rows = (await sql`
      SELECT
        COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')), 0)::bigint AS revenue_cents,
        COUNT(*) FILTER (WHERE status IN ('paid','fulfilled'))::int AS sales_count
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND created_at >= ${from}::date
        AND created_at <  (${to}::date + interval '1 day')
        AND (
          ${noNodeFilter}::boolean
          OR created_by_user_node = ANY(${nodes}::uuid[])
        )
        AND (
          ${isRootScope}::boolean            -- root: any source
          OR source = 'pos'                  -- subtree: attributed POS only
        )
    `) as Array<{ revenue_cents: string; sales_count: number }>;
    const r = rows[0]!;
    const revenue = Number(r.revenue_cents);
    const sales = Number(r.sales_count);
    return { revenue, sales, aov: sales > 0 ? Math.round(revenue / sales) : 0 };
  }

  const cur = await windowKpis(q.from, q.to);
  const cmp = compareWindow(q.from, q.to, q.compare);
  const prior = cmp ? await windowKpis(cmp.from, cmp.to) : null;

  const mk = (id: 'revenue' | 'sales' | 'aov', label: string, unit: 'cents' | 'count') => ({
    id, label, unit,
    value: cur[id],
    delta: prior ? cur[id] - prior[id] : null,
    deltaPct: prior ? pctDelta(cur[id], prior[id]) : null,
  });

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    kpis: [
      mk('revenue', 'Revenue', 'cents'),
      mk('sales', 'Sales', 'count'),
      mk('aov', 'Avg order value', 'cents'),
    ],
    series: [],
    breakdowns: [],
    generatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/analytics/sales-kpis.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/analytics-sales.ts tests/analytics/sales-kpis.test.ts
git commit -m "feat(analytics): analytics-sales KPIs (revenue/sales/AOV) with subtree scope + compare deltas"
```

---

## Task 6: `analytics-sales.ts` — revenue-by-day series + channel/category breakdowns

**Files:**
- Modify: `netlify/functions/analytics-sales.ts`
- Test: `tests/analytics/sales-series.test.ts`

**Interfaces:**
- Produces (extends Task 5 response): `series` includes `{ id:'revenue_by_day', chart:'line', points:[{x:'YYYY-MM-DD', y:cents}] }` bucketed by `date_trunc(granularity, created_at AT TIME ZONE :tz)`. `breakdowns` includes `{ id:'by_channel', ... }` and `{ id:'by_category', ... }`.
- Consumes the client's timezone. Resolve it once: `SELECT timezone FROM public.clients WHERE id = :clientId` (confirm the column name by reading the latest `clients` table migration; if no per-client tz column exists, default to `'UTC'` and leave a `// TODO(tz): per-client timezone source` note — do NOT fabricate a column).

- [ ] **Step 1: Write the failing test**

```ts
// tests/analytics/sales-series.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-sales';
import { seedPaidSales } from './_analytics-helpers'; // see note below

let ctx: any;
const FROM = '2026-04-10', TO = '2026-04-12';

beforeAll(async () => {
  ctx = await seedPaidSales({
    when: [`${FROM}T09:00:00Z`, `${FROM}T15:00:00Z`, `2026-04-11T12:00:00Z`],
    channel: ['instore', 'instore', 'pickup'],
    priceCents: 500,
  });
});

describe('analytics-sales series + breakdowns', () => {
  it('returns revenue-by-day points within the window', async () => {
    const res = await handler(makeReq(ctx, `/api/analytics-sales?from=${FROM}&to=${TO}&granularity=day`));
    const body = await res.json();
    const series = body.series.find((s: any) => s.id === 'revenue_by_day');
    const day1 = series.points.find((p: any) => p.x === FROM);
    expect(day1.y).toBe(1000); // two 500c sales on day 1
  });

  it('breaks revenue down by channel', async () => {
    const res = await handler(makeReq(ctx, `/api/analytics-sales?from=${FROM}&to=${TO}`));
    const body = await res.json();
    const ch = body.breakdowns.find((b: any) => b.id === 'by_channel');
    const instore = ch.rows.find((r: any) => r.key === 'instore');
    expect(instore.value).toBe(1000);
  });
});

function makeReq(ctx: any, path: string) {
  const { makeBucketUserRequest } = require('../pos/_helpers');
  return makeBucketUserRequest(ctx, 'GET', path);
}
```

> **First create `tests/analytics/_analytics-helpers.ts`** exporting `seedPaidSales({when, channel, priceCents})`: seed a client (reuse `seedClientWithProductsEnabled`), grant `analytics.business.view` to L1, insert one product, then INSERT sales rows directly via `db()` with explicit `status='paid'`, `paid_at`, `created_at` from `when`, `channel` from the array, `created_by_user_node = ctx.userNodeId`, `source='pos'`, and matching `sale_lines`. Direct INSERT keeps series tests deterministic and fast. Return the `ctx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/sales-series.test.ts`
Expected: FAIL — `series` is empty / `by_channel` missing.

- [ ] **Step 3: Add the timezone lookup + series + breakdown queries**

Insert, after the KPI block in `analytics-sales.ts`, before the `jsonOk`:

```ts
  // Resolve tenant timezone once (fallback UTC). Confirm the real column name.
  const tzRows = (await sql`
    SELECT COALESCE(timezone, 'UTC') AS tz FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ tz: string }>;
  const tz = tzRows[0]?.tz ?? 'UTC';

  const gran = q.granularity; // 'day' | 'week' | 'month'

  const seriesRows = (await sql`
    SELECT to_char(date_trunc(${gran}, (created_at AT TIME ZONE ${tz})), 'YYYY-MM-DD') AS x,
           COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')), 0)::bigint AS y
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
      AND created_at >= ${q.from}::date
      AND created_at <  (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
      AND (${isRootScope}::boolean OR source = 'pos')
    GROUP BY 1 ORDER BY 1
  `) as Array<{ x: string; y: string }>;

  const channelRows = (await sql`
    SELECT channel::text AS key,
           COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')), 0)::bigint AS value
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
      AND created_at >= ${q.from}::date
      AND created_at <  (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
      AND (${isRootScope}::boolean OR source = 'pos')
    GROUP BY 1 ORDER BY 2 DESC
  `) as Array<{ key: string; value: string }>;

  const categoryRows = (await sql`
    SELECT COALESCE(pc.name, 'Uncategorised') AS key,
           COALESCE(SUM(sl.line_total_cents), 0)::bigint AS value
    FROM public.sale_lines sl
    JOIN public.sales s ON s.id = sl.sale_id
    LEFT JOIN public.products p ON p.id = sl.product_id
    LEFT JOIN public.product_categories pc ON pc.id = p.category_id
    WHERE s.bucket_id = ${clientId}::uuid
      AND s.status IN ('paid','fulfilled')
      AND s.created_at >= ${q.from}::date
      AND s.created_at <  (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR s.created_by_user_node = ANY(${nodes}::uuid[]))
      AND (${isRootScope}::boolean OR s.source = 'pos')
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
  `) as Array<{ key: string; value: string }>;

  const toRows = (rs: Array<{ key: string; value: string }>) => {
    const nums = rs.map((r) => ({ key: r.key, value: Number(r.value) }));
    const total = nums.reduce((a, b) => a + b.value, 0) || 1;
    return nums.map((r) => ({ ...r, pct: (r.value / total) * 100 }));
  };
```

Then replace the `series: []` / `breakdowns: []` lines in `jsonOk` with:

```ts
    series: [
      { id: 'revenue_by_day', chart: 'line',
        points: seriesRows.map((r) => ({ x: r.x, y: Number(r.y) })) },
    ],
    breakdowns: [
      { id: 'by_channel', label: 'By channel', rows: toRows(channelRows) },
      { id: 'by_category', label: 'By category', rows: toRows(categoryRows) },
    ],
```

> Confirm `sale_lines` column names (`line_total_cents`, `product_id`) and `products.category_id` by reading migrations `041_sale_lines.sql`, `034_products.sql`, `033_product_categories.sql`. Adjust names if they differ; do not guess.

- [ ] **Step 4: Run test + typecheck + full sales suite**

Run: `npx vitest run tests/analytics/ && npm run typecheck`
Expected: PASS (Task 5 KPI test still green — predicate parity preserved).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/analytics-sales.ts tests/analytics/sales-series.test.ts tests/analytics/_analytics-helpers.ts
git commit -m "feat(analytics): revenue-by-day series + channel/category breakdowns (tz-bucketed)"
```

---

## Task 7: `analytics-overview.ts` — headline scorecard across permitted buckets

**Files:**
- Create: `netlify/functions/analytics-overview.ts`
- Test: `tests/analytics/overview.test.ts`

**Interfaces:**
- Produces: `GET /api/analytics-overview` → `{ scope, buckets: Bucket[], kpis: Array<{ id, label, value, unit }> }` where `kpis` contains one headline per **permitted** bucket (business→revenue, customers→#customers, employees→active staff, products→catalog size). A caller with only `analytics.business.view` gets only the business KPI and `buckets: ['business']`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/analytics/overview.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-overview';
import { seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest } from '../pos/_helpers';

let ctx: Awaited<ReturnType<typeof seedClientWithProductsEnabled>>;
beforeAll(async () => { ctx = await seedClientWithProductsEnabled(); await grantPerms(ctx.clientId, 1, []); });

describe('GET /api/analytics-overview', () => {
  it('owner gets all four headline buckets', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/analytics-overview?from=2026-03-01&to=2026-03-01'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buckets.sort()).toEqual(['business', 'customers', 'employees', 'products']);
  });
  it('a sub with only business sees only the business headline', async () => {
    const sub = await seedSubordinateUser(ctx, 2, ['analytics.business.view']);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/analytics-overview?from=2026-03-01&to=2026-03-01'));
    const body = await res.json();
    expect(body.buckets).toEqual(['business']);
    expect(body.kpis.every((k: any) => k.id === 'revenue')).toBe(true);
  });
  it('a sub with no analytics keys is 403', async () => {
    const sub = await seedSubordinateUser(ctx, 3, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/analytics-overview?from=2026-03-01&to=2026-03-01'));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/overview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the endpoint**

```ts
// netlify/functions/analytics-overview.ts
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess, type Bucket } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';

export const config = { path: '/api/analytics-overview', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  // No requiredBucket — overview returns whatever the caller is entitled to.
  const auth = await resolveAnalyticsAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId, isRootScope, scopeNodes, buckets } = auth.access;
  if (buckets.size === 0) return jsonError(403, 'forbidden');

  let q: AnalyticsQuery;
  try {
    q = AnalyticsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const nodes = scopeNodes ?? [];
  const noNodeFilter = scopeNodes === null;
  const kpis: Array<{ id: string; label: string; value: number; unit: string }> = [];

  if (buckets.has('business')) {
    const r = (await sql`
      SELECT COALESCE(SUM(total_cents) FILTER (WHERE status IN ('paid','fulfilled')),0)::bigint AS v
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND created_at >= ${q.from}::date AND created_at < (${q.to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
        AND (${isRootScope}::boolean OR source = 'pos')
    `) as Array<{ v: string }>;
    kpis.push({ id: 'revenue', label: 'Revenue', value: Number(r[0]!.v), unit: 'cents' });
  }
  if (buckets.has('customers')) {
    const r = (await sql`
      SELECT COUNT(DISTINCT customer_phone)::int AS v
      FROM public.sales
      WHERE bucket_id = ${clientId}::uuid
        AND created_at >= ${q.from}::date AND created_at < (${q.to}::date + interval '1 day')
        AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
        AND (${isRootScope}::boolean OR source = 'pos')
    `) as Array<{ v: number }>;
    kpis.push({ id: 'customers', label: 'Customers', value: Number(r[0]!.v), unit: 'count' });
  }
  if (buckets.has('employees')) {
    const r = (await sql`
      SELECT COUNT(*)::int AS v FROM public.user_nodes
      WHERE client_id = ${clientId}::uuid
        AND (${noNodeFilter}::boolean OR id = ANY(${nodes}::uuid[]))
    `) as Array<{ v: number }>;
    kpis.push({ id: 'staff', label: 'Team members', value: Number(r[0]!.v), unit: 'count' });
  }
  if (buckets.has('products')) {
    const r = (await sql`
      SELECT COUNT(*)::int AS v FROM public.products
      WHERE bucket_id = ${clientId}::uuid AND status = 'active'
    `) as Array<{ v: number }>;
    kpis.push({ id: 'catalog', label: 'Active products', value: Number(r[0]!.v), unit: 'count' });
  }

  return jsonOk({
    scope: { isRootScope, nodeCount: scopeNodes === null ? 0 : scopeNodes.length },
    buckets: [...buckets].sort(),
    kpis,
  });
}
```

> Confirm `products.bucket_id` (vs `client_id`) and the `status='active'` enum by reading `034_products.sql`. Adjust column names if needed.

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/analytics/overview.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/analytics-overview.ts tests/analytics/overview.test.ts
git commit -m "feat(analytics): overview scorecard returning one headline per permitted bucket"
```

---

## Task 8: `analytics-sales-export.ts` — XLSX/CSV export

**Files:**
- Create: `netlify/functions/analytics-sales-export.ts`
- Test: `tests/analytics/sales-export.test.ts`

**Interfaces:**
- Produces: `GET /api/analytics-sales-export?from&to&format=xlsx|csv` → a file download (Content-Disposition attachment). Two logical sheets/sections: **Summary** (the KPI + breakdown rows) and **Rows** (the underlying paid/fulfilled sales in the window+scope). Reuses the existing export approach.

- [ ] **Step 1: Read the existing export pattern**

Read `netlify/functions/u-products-export.ts` and `netlify/functions/workspace-export.ts` to copy the exact XLSX library + tz-date formatting (`xlsx-tz`) and the Content-Type/Content-Disposition headers used there. Match that pattern — do not introduce a new export library.

- [ ] **Step 2: Write the failing test**

```ts
// tests/analytics/sales-export.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-sales-export';
import { seedPaidSales } from './_analytics-helpers';
import { makeBucketUserRequest } from '../pos/_helpers';

let ctx: any;
const FROM = '2026-05-04', TO = '2026-05-04';
beforeAll(async () => {
  ctx = await seedPaidSales({ when: [`${FROM}T10:00:00Z`], channel: ['instore'], priceCents: 700 });
});

describe('GET /api/analytics-sales-export', () => {
  it('csv export returns an attachment with the revenue total', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/analytics-sales-export?from=${FROM}&to=${TO}&format=csv`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const text = await res.text();
    expect(text).toContain('700'); // revenue cents present in the summary
  });
  it('rejects a caller lacking analytics.business.view', async () => {
    const { seedSubordinateUser } = await import('../pos/_helpers');
    const sub = await seedSubordinateUser(ctx, 4, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', `/api/analytics-sales-export?from=${FROM}&to=${TO}&format=csv`));
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/analytics/sales-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the endpoint**

Reuse `resolveAnalyticsAccess(req, 'business')` and the same scoped sales query as Task 5/6. For `format=csv`, build a CSV string (summary lines + a header row + one line per sale). For `format=xlsx`, use the same workbook builder as `u-products-export.ts` with tz-formatted date columns. Set headers exactly as that file does:

```ts
export const config = { path: '/api/analytics-sales-export', method: 'GET' };
// ... resolve access (business), parse query (add format to AnalyticsQuery or read separately),
// run the scoped paid/fulfilled sales query, then:
//   csv:  new Response(csvString, { status: 200, headers: { 'Content-Type':'text/csv',
//          'Content-Disposition':`attachment; filename="sales-${from}_${to}.csv"`, 'Cache-Control':'no-store' }})
//   xlsx: mirror u-products-export.ts (Buffer/Uint8Array body + spreadsheet content-type).
```

> Add `format: z.enum(['xlsx','csv']).default('xlsx')` to `AnalyticsQuery` (Task 4) or parse it separately in this handler. Keep the column set tz-correct using the same helper `u-products-export.ts` uses.

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/analytics/sales-export.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/analytics-sales-export.ts tests/analytics/sales-export.test.ts netlify/functions/_analytics-validators.ts
git commit -m "feat(analytics): sales export (xlsx/csv) reusing tz-correct export pattern"
```

---

## Task 9: Frontend — Recharts wrappers + KpiTile

**Files:**
- Create: `src/modules/analytics/components/KpiTile.tsx`, `TrendChart.tsx`, `BarChart.tsx`, `DonutChart.tsx`
- Test: `src/modules/analytics/__tests__/KpiTile.test.tsx`
- Modify: `package.json` (add `recharts`)

**Interfaces:**
- Produces:
  - `KpiTile({ label, value, unit, deltaPct })` — renders label, formatted value (cents → currency, count → integer), and a +/- delta badge.
  - `TrendChart({ points })`, `BarChart({ rows })`, `DonutChart({ rows })` — thin Recharts wrappers; the only files importing from `recharts`.

- [ ] **Step 1: Add Recharts**

Run: `npm install recharts`
Then confirm it lands in `dependencies` and `npm run typecheck` still passes.

> If Netlify bundling needs it, also confirm whether `recharts` must be added to `external_node_modules` in `netlify.toml` (per the deploy checklist). It is a frontend (vite-bundled) dep, not a function dep, so it should NOT need external_node_modules — but note this for the deploy step.

- [ ] **Step 2: Write the failing test**

```tsx
// src/modules/analytics/__tests__/KpiTile.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiTile } from '../components/KpiTile';

describe('KpiTile', () => {
  it('formats cents as currency', () => {
    render(<KpiTile label="Revenue" value={250000} unit="cents" deltaPct={12.5} />);
    expect(screen.getByText(/2,500/)).toBeInTheDocument();
    expect(screen.getByText(/12.5%/)).toBeInTheDocument();
  });
  it('formats counts as integers and hides delta when null', () => {
    render(<KpiTile label="Sales" value={42} unit="count" deltaPct={null} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/modules/analytics/__tests__/KpiTile.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement KpiTile + chart wrappers**

```tsx
// src/modules/analytics/components/KpiTile.tsx
interface Props { label: string; value: number; unit: 'cents' | 'count'; deltaPct: number | null }

export function KpiTile({ label, value, unit, deltaPct }: Props) {
  const display = unit === 'cents'
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value / 100)
    : new Intl.NumberFormat().format(value);
  const up = (deltaPct ?? 0) >= 0;
  return (
    <div className="analytics-kpi-tile">
      <div className="analytics-kpi-label">{label}</div>
      <div className="analytics-kpi-value">{display}</div>
      {deltaPct != null && (
        <div className={`analytics-kpi-delta ${up ? 'is-up' : 'is-down'}`}>
          {up ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
```

```tsx
// src/modules/analytics/components/TrendChart.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
export function TrendChart({ points }: { points: Array<{ x: string; y: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points}>
        <XAxis dataKey="x" /><YAxis /><Tooltip />
        <Line type="monotone" dataKey="y" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

```tsx
// src/modules/analytics/components/BarChart.tsx
import { BarChart as RBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
export function BarChart({ rows }: { rows: Array<{ key: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <RBarChart data={rows}>
        <XAxis dataKey="key" /><YAxis /><Tooltip /><Bar dataKey="value" />
      </RBarChart>
    </ResponsiveContainer>
  );
}
```

```tsx
// src/modules/analytics/components/DonutChart.tsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
const COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
export function DonutChart({ rows }: { rows: Array<{ key: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="key" innerRadius={50} outerRadius={80}>
          {rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

> Currency: this plan hardcodes INR (matches the India/Razorpay context). If a per-client currency exists, thread it through later; for now INR is the explicit default.

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/modules/analytics/__tests__/KpiTile.test.tsx && npm run typecheck`
Expected: PASS. (Charts render under jsdom; if Recharts ResponsiveContainer warns about zero width in tests, that is benign — tests assert on KpiTile, not chart internals.)

- [ ] **Step 6: Commit**

```bash
git add src/modules/analytics/components package.json package-lock.json src/modules/analytics/__tests__/KpiTile.test.tsx
git commit -m "feat(analytics): KpiTile + Recharts trend/bar/donut wrappers"
```

---

## Task 10: Frontend — API client, types, useAnalytics hook

**Files:**
- Create: `src/modules/analytics/types.ts`, `src/modules/analytics/api.ts`, `src/modules/analytics/hooks/useAnalytics.ts`
- Test: `src/modules/analytics/__tests__/useAnalytics.test.tsx`

**Interfaces:**
- Produces:
  - `types.ts`: `Kpi`, `Series`, `Breakdown`, `SalesResponse`, `OverviewResponse`.
  - `api.ts`: `fetchSales(params)`, `fetchOverview(params)`, `salesExportUrl(params)` — call `/api/analytics-*` with credentials.
  - `useAnalytics(domain, params)`: `{ data, loading, error }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/analytics/__tests__/useAnalytics.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAnalytics } from '../hooks/useAnalytics';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ scope: { isRootScope: true, nodeCount: 0 }, kpis: [], series: [], breakdowns: [], generatedAt: 'x' }),
  })) as any);
});

describe('useAnalytics', () => {
  it('loads sales data', async () => {
    const { result } = renderHook(() => useAnalytics('sales', { from: '2026-06-01', to: '2026-06-30' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeTruthy();
    expect(result.current.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/analytics/__tests__/useAnalytics.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types, api, hook**

```ts
// src/modules/analytics/types.ts
export interface Kpi { id: string; label: string; value: number; unit: 'cents' | 'count'; delta?: number | null; deltaPct?: number | null }
export interface Series { id: string; chart: 'line' | 'bar'; points: Array<{ x: string; y: number }> }
export interface Breakdown { id: string; label: string; rows: Array<{ key: string; value: number; pct: number }> }
export interface Scope { isRootScope: boolean; nodeCount: number }
export interface SalesResponse { scope: Scope; kpis: Kpi[]; series: Series[]; breakdowns: Breakdown[]; generatedAt: string }
export interface OverviewResponse { scope: Scope; buckets: string[]; kpis: Kpi[] }
export interface AnalyticsParams { from: string; to: string; compare?: string; granularity?: string; node?: string }
```

```ts
// src/modules/analytics/api.ts
import type { SalesResponse, OverviewResponse, AnalyticsParams } from './types';

function qs(p: AnalyticsParams): string {
  const u = new URLSearchParams();
  u.set('from', p.from); u.set('to', p.to);
  if (p.compare) u.set('compare', p.compare);
  if (p.granularity) u.set('granularity', p.granularity);
  if (p.node) u.set('node', p.node);
  return u.toString();
}
async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}
export const fetchSales = (p: AnalyticsParams) => get<SalesResponse>(`/api/analytics-sales?${qs(p)}`);
export const fetchOverview = (p: AnalyticsParams) => get<OverviewResponse>(`/api/analytics-overview?${qs(p)}`);
export const salesExportUrl = (p: AnalyticsParams, format: 'xlsx' | 'csv') =>
  `/api/analytics-sales-export?${qs(p)}&format=${format}`;
```

```ts
// src/modules/analytics/hooks/useAnalytics.ts
import { useEffect, useState } from 'react';
import { fetchSales, fetchOverview } from '../api';
import type { AnalyticsParams } from '../types';

export function useAnalytics(domain: 'sales' | 'overview', params: AnalyticsParams) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify({ domain, params });
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    const call = domain === 'sales' ? fetchSales(params) : fetchOverview(params);
    call.then((d) => { if (alive) { setData(d); setLoading(false); } })
        .catch((e) => { if (alive) { setError(String(e?.message ?? e)); setLoading(false); } });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, loading, error };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/modules/analytics/__tests__/useAnalytics.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/analytics/types.ts src/modules/analytics/api.ts src/modules/analytics/hooks src/modules/analytics/__tests__/useAnalytics.test.tsx
git commit -m "feat(analytics): FE types, api client, useAnalytics hook"
```

---

## Task 11: Frontend — Dashboard, FilterBar, Sales DomainPanel + nav/route wiring

**Files:**
- Create: `src/modules/analytics/components/FilterBar.tsx`, `DomainPanel.tsx`, `AnalyticsDashboard.tsx`, `src/modules/analytics/AnalyticsRouteMount.tsx`
- Modify: `src/modules/user-portal/nav/useNavItems.ts` (add `analytics` to dedicated-nav set), the Sidebar component, and the user-portal route table.
- Test: `src/modules/user-portal/nav/useNavItems.test.ts` (extend), `src/modules/analytics/__tests__/AnalyticsDashboard.test.tsx`

**Interfaces:**
- Consumes: `useAnalytics`, `KpiTile`, `TrendChart`, `BarChart`, `DonutChart`, `salesExportUrl`.
- Produces: a mounted route at `/c/:slug/analytics` and a sidebar entry visible iff the user holds any `analytics.*.view` key.

- [ ] **Step 1: Write the failing nav test (extend existing)**

```ts
// add to src/modules/user-portal/nav/useNavItems.test.ts
import { computeNavItems } from './useNavItems';

it('analytics is NOT in the generic rail (it has dedicated nav)', () => {
  const items = computeNavItems({
    slug: 'acme', levelNumber: 1,
    enabledModules: [{ key: 'analytics', label: 'Analytics' } as any],
    permissions: {},
  });
  expect(items.find((i) => i.moduleKey === 'analytics')).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/user-portal/nav/useNavItems.test.ts`
Expected: FAIL — `analytics` currently appears in the generic rail (not yet in `MODULES_WITH_DEDICATED_NAV`).

- [ ] **Step 3: Add analytics to the dedicated-nav set**

```ts
// src/modules/user-portal/nav/useNavItems.ts:24
const MODULES_WITH_DEDICATED_NAV = new Set<string>(['products', 'pos', 'booking', 'analytics']);
```

- [ ] **Step 4: Run the nav test to verify it passes**

Run: `npx vitest run src/modules/user-portal/nav/useNavItems.test.ts`
Expected: PASS.

- [ ] **Step 5: Build FilterBar, DomainPanel, Dashboard, RouteMount**

```tsx
// src/modules/analytics/components/FilterBar.tsx
import type { AnalyticsParams } from '../types';
const PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Today', days: 0 }, { label: '7d', days: 6 }, { label: '30d', days: 29 },
];
export function FilterBar({ params, onChange, exportHref }: {
  params: AnalyticsParams; onChange: (p: AnalyticsParams) => void; exportHref: string;
}) {
  const setPreset = (days: number) => {
    const to = new Date(); const from = new Date(); from.setDate(to.getDate() - days);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    onChange({ ...params, from: iso(from), to: iso(to) });
  };
  return (
    <div className="analytics-filterbar">
      {PRESETS.map((p) => <button key={p.label} onClick={() => setPreset(p.days)}>{p.label}</button>)}
      <select value={params.compare ?? 'none'} onChange={(e) => onChange({ ...params, compare: e.target.value })}>
        <option value="none">No comparison</option>
        <option value="prior_period">vs prior period</option>
        <option value="prior_year">vs prior year</option>
      </select>
      <a className="analytics-export" href={exportHref}>Export</a>
    </div>
  );
}
```

```tsx
// src/modules/analytics/components/DomainPanel.tsx
import { KpiTile } from './KpiTile';
import { TrendChart } from './TrendChart';
import { BarChart } from './BarChart';
import { DonutChart } from './DonutChart';
import type { SalesResponse } from '../types';
export function SalesPanel({ data }: { data: SalesResponse }) {
  const byChannel = data.breakdowns.find((b) => b.id === 'by_channel');
  const byCategory = data.breakdowns.find((b) => b.id === 'by_category');
  const revSeries = data.series.find((s) => s.id === 'revenue_by_day');
  return (
    <section className="analytics-panel">
      <h2>Sales</h2>
      <div className="analytics-kpi-row">
        {data.kpis.map((k) => <KpiTile key={k.id} label={k.label} value={k.value} unit={k.unit} deltaPct={k.deltaPct ?? null} />)}
      </div>
      {revSeries && <TrendChart points={revSeries.points} />}
      <div className="analytics-breakdown-row">
        {byChannel && <BarChart rows={byChannel.rows} />}
        {byCategory && <DonutChart rows={byCategory.rows} />}
      </div>
    </section>
  );
}
```

```tsx
// src/modules/analytics/components/AnalyticsDashboard.tsx
import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { SalesPanel } from './DomainPanel';
import { useAnalytics } from '../hooks/useAnalytics';
import { salesExportUrl } from '../api';
import type { AnalyticsParams } from '../types';

function todayIso() { return new Date().toISOString().slice(0, 10); }

export function AnalyticsDashboard() {
  const [params, setParams] = useState<AnalyticsParams>({ from: todayIso(), to: todayIso(), compare: 'none', granularity: 'day' });
  const { data, loading, error } = useAnalytics('sales', params);
  return (
    <div className="analytics-dashboard">
      <header><h1>Analytics</h1></header>
      <FilterBar params={params} onChange={setParams} exportHref={salesExportUrl(params, 'xlsx')} />
      {loading && <p>Loading…</p>}
      {error && <p className="analytics-error">Couldn’t load analytics ({error}).</p>}
      {data && <SalesPanel data={data} />}
    </div>
  );
}
```

```tsx
// src/modules/analytics/AnalyticsRouteMount.tsx
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
export default function AnalyticsRouteMount() { return <AnalyticsDashboard />; }
```

- [ ] **Step 6: Wire the route + sidebar entry**

Read how `PosRouteMounts.tsx` and the Sidebar register a dedicated module (find the route table that maps `/c/:slug/...` and the Sidebar list). Add:
- A route `/c/:slug/analytics` → `<AnalyticsRouteMount />`.
- A Sidebar link to that route, shown iff the user holds any `analytics.*.view` key (reuse the same `hasViewOnModule('analytics')` style check the sidebar already uses for dedicated modules; owners always see it).

> Match the EXACT pattern the sidebar uses for `pos`/`booking` dedicated entries. Do not invent a new gating mechanism.

- [ ] **Step 7: Write a dashboard smoke test**

```tsx
// src/modules/analytics/__tests__/AnalyticsDashboard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({
      scope: { isRootScope: true, nodeCount: 0 },
      kpis: [{ id: 'revenue', label: 'Revenue', value: 123400, unit: 'cents', deltaPct: 5 }],
      series: [{ id: 'revenue_by_day', chart: 'line', points: [{ x: '2026-06-01', y: 123400 }] }],
      breakdowns: [{ id: 'by_channel', label: 'By channel', rows: [{ key: 'instore', value: 123400, pct: 100 }] }],
      generatedAt: 'x',
    }),
  })) as any);
});

describe('AnalyticsDashboard', () => {
  it('renders the Sales panel with a KPI after load', async () => {
    render(<AnalyticsDashboard />);
    await waitFor(() => expect(screen.getByText('Sales')).toBeInTheDocument());
    expect(screen.getByText('Revenue')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run all analytics + nav tests + typecheck**

Run: `npx vitest run src/modules/analytics src/modules/user-portal/nav && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/analytics src/modules/user-portal
git commit -m "feat(analytics): dashboard + FilterBar + Sales panel, route mount + sidebar nav gating"
```

---

## Task 12: Full-suite green + access-level UI verification

**Files:**
- Test: run the entire suite; manual check of the access-level dashboard.

- [ ] **Step 1: Run the FULL test suite**

Run: `npm test` (or `npx vitest run`)
Expected: ALL pass. The shared dev DB means a partial run can hide cross-suite collisions — run everything.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify the four analytics keys render in the access-level UI**

Start the app (`netlify dev --port <p> --target-port <tp>`), open the per-client Access Level dashboard, and confirm the Analytics module row appears with **view-only** toggles for business/customers/employees/products (no create/edit/delete columns). This confirms the manifest-derived matrix row renders — the failure mode flagged in the `permission-keys-bucket-verb-only` memory.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test(analytics): full-suite green; access-level UI renders analytics view toggles"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §1 purpose → Tasks 9–11 (dashboard-first). §2 approach A → all backend tasks (live SQL, no migration). §3 structure → file layout + Tasks. §4 manifest → Task 1 + extensible KpiSpec realised inline (full manifest-driven `KpiSpec[]` generalisation deferred to per-domain plans; Sales proves the shape). §5 scoping → Task 3 (+ used in 5/6/7/8). §6 permissions → Tasks 1, 3, 7, 12. §7 endpoint contract → Tasks 5–7. §8 frontend → Tasks 9–11. §9 export → Task 8. §10 testing → every task + Task 12. §11 exclusions → respected (no email/forecast/finance). §12 sequence → this plan = framework + Sales; domains 2–5 are follow-on plans.
- **Placeholder scan:** No TBD/TODO left as deliverables. Two explicit "confirm the real column name / contract by reading migration X" notes remain — these are deliberate verification steps (the plan must not fabricate schema names it hasn't seen), each with a named file to check and a fallback instruction.
- **Type consistency:** `resolveAnalyticsAccess`/`AnalyticsAccess`/`Bucket`/`AnalyticsQuery`/`compareWindow`/`pctDelta` names are used identically across tasks. Response shape (`scope`/`kpis`/`series`/`breakdowns`) is consistent between endpoint (Task 5/6) and FE types (Task 10).

## Note for follow-on plans (domains 2–5)

Once this plan lands and the framework shapes are locked, each remaining domain is a near-mechanical repeat: a new `analytics-<domain>.ts` endpoint reusing `resolveAnalyticsAccess` + `_analytics-sql`, a manifest entry, a `<Domain>Panel`, and its scoped queries (Bookings → `user_node_id`; Customers → phone-keyed new/returning; Team → `audit_log`; Catalog → tenant-wide, `analytics.products.view`). Each gets its own short plan via writing-plans.

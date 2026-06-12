# POS Module v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a staff-facing POS module (Menu / Cart / Sale History) that takes orders against the existing Product Manager catalog, persists sales with a 5-state FSM, and exposes 8 permission keys through the existing AMS matrix. Razorpay is stubbed; "Mark paid (cash)" is the only payment path in v1.

**Architecture:** New product registered in `src/modules/registry`; new FE module at `src/modules/pos/`; new backend bucket at `netlify/functions/pos/`; 3 additive Postgres migrations (sales, sale_lines, registry enable). Per-bucket monotonic `order_no`. Snapshot pricing — server reads `products.sale_price_cents` at submit time. Cart state is a localStorage-persisted zustand store with an idempotency key per submit cycle.

**Tech Stack:** Vite + React 18 + TypeScript + zustand + react-router-dom (FE); Netlify Functions v2 + Neon Postgres + zod + Argon2 sessions (BE); vitest + happy-dom (tests).

**Scope:** v1 staff-only POS per `docs/superpowers/specs/2026-06-12-pos-module-design.md`. Customer-facing storefront, Razorpay, line notes, line/cart discounts, tax, refund money-movement are out.

**Worktree:** `../ExSol-POS-WT` on branch `feat/pos-module-iso`. No push. Sibling chat owns main/prod.

---

## File Structure

### New files
```
src/modules/pos/
├── PosRoutes.tsx
├── api.ts
├── store/cart.ts
├── pages/{MenuPage,CartPage,SalesListPage}.tsx
├── pages/SaleDetailDrawer.tsx
├── components/{ProductTile,MenuSearchBar,CategoryTabs,SideCartPanel}.tsx
├── components/{CartLineRow,CustomerForm,ChannelPicker}.tsx
├── components/{StatusPill,SaleStateButtons}.tsx
├── lib/{fsm,money}.ts
└── __tests__/{cart-store,fsm,money,MenuPage,CartPage,SalesListPage}.spec.{ts,tsx}

src/modules/registry/manifests/pos.ts
src/modules/registry/products-list/pos.ts

netlify/functions/pos/
├── menu.ts
├── sale-create.ts
├── sales-list.ts
├── sale-detail.ts
├── sale-state.ts
├── _validators.ts
└── _fsm.ts                  (server-side state-machine guards — pure)

tests/pos/
├── menu.spec.ts
├── sale-create.spec.ts
├── sales-list.spec.ts
├── sale-detail.spec.ts
└── sale-state.spec.ts

db/migrations/
├── 040_sales.sql
├── 041_sale_lines.sql
└── 042_pos_product_enable.sql
```

### Modified files
```
src/modules/registry/types.ts                   (extend PermissionKey union — Task 1)
src/modules/registry/modules.ts                 (register posManifest — Task 2)
src/modules/registry/products.ts                (register posProduct  — Task 2)
src/App.tsx OR src/modules/user-portal/UserPortalRoutes.tsx
                                                (mount /pos/* — Task 18)
```

### Out of scope for this plan
- `db/migrations/039_products_pos_visible.sql` — written by the **PM chat**. POS plan assumes column exists. Task 5 has a fallback path for local dev.
- `feat/product-manager-iso` worktree edits — PM chat owns.

---

## Phase 1 — Registry & schema foundation (Tasks 1–6)

### Task 1: Extend `PermissionKey` to admit POS actions

The spec'd POS keys (`pos.sale.markPaid`, `pos.history.viewAll`, …) don't fit the existing `<module>.<bucket>.<verb>` or `_platform.<surface>.<verb>` patterns. Resolve by adding a third pattern, `pos.${PosAction}`, with a fixed string-literal list.

**Files:**
- Modify: `src/modules/registry/types.ts` — append the new pattern + action list
- Test: `src/modules/registry/__tests__/types.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/modules/registry/__tests__/types.spec.ts`:
```ts
import { describe, it, expectTypeOf } from 'vitest';
import type { PermissionKey } from '../types';
import { POS_ACTIONS, type PosAction } from '../types';

describe('PermissionKey union', () => {
  it('admits the 8 POS actions', () => {
    expectTypeOf<`pos.${PosAction}`>().toExtend<PermissionKey>();
    expect(POS_ACTIONS).toHaveLength(8);
    expect(POS_ACTIONS).toContain('menu.view');
    expect(POS_ACTIONS).toContain('history.viewAll');
  });
  it('rejects unknown POS actions at the type layer', () => {
    // @ts-expect-error — 'sale.zorp' is not a PosAction
    const _bad: PermissionKey = 'pos.sale.zorp';
  });
});
```

(Note: `import { describe, it, expect, expectTypeOf } from 'vitest'`; the test missed `expect` — include it.)

- [ ] **Step 2: Run to verify FAIL**

```
npx vitest run src/modules/registry/__tests__/types.spec.ts
```
Expected: `POS_ACTIONS` import fails — symbol does not exist.

- [ ] **Step 3: Extend `types.ts`**

Append to `src/modules/registry/types.ts`:
```ts
// POS uses an action-namespaced key shape because its operations
// (markPaid, fulfill, refund, …) are not CRUD verbs over data_buckets.
// Other modules still use `<module>.<bucket>.<verb>`; POS adds a third
// pattern to the union.
export const POS_ACTIONS = [
  'menu.view',
  'sale.create',
  'sale.markPaid',
  'sale.fulfill',
  'sale.cancel',
  'sale.refund',
  'history.view',
  'history.viewAll',
] as const;
export type PosAction = (typeof POS_ACTIONS)[number];

export type PermissionKey =
  | `${ModuleKey}.${DataBucket}.${Verb}`
  | `_platform.${PlatformSurface}.${Verb}`
  | `pos.${PosAction}`;
```

(Delete the original single-line `PermissionKey` declaration earlier in the file — replace with the 3-arm union above.)

- [ ] **Step 4: Run to verify PASS + typecheck**

```
npx vitest run src/modules/registry/__tests__/types.spec.ts
npm run typecheck
```
Expected: PASS + clean typecheck (no other module breaks).

- [ ] **Step 5: Commit**

```
git add src/modules/registry/types.ts src/modules/registry/__tests__/types.spec.ts
git commit -m "feat(registry): extend PermissionKey to admit pos.<action> namespace"
```

---

### Task 2: POS module + product manifests

**Files:**
- Create: `src/modules/registry/manifests/pos.ts`
- Create: `src/modules/registry/products-list/pos.ts`
- Modify: `src/modules/registry/modules.ts` — register `pos: posManifest`
- Modify: `src/modules/registry/products.ts` — register `'pos': posProduct`
- Test: `src/modules/registry/__tests__/pos-manifests.spec.ts` (create)

- [ ] **Step 1: Failing test**

Create `src/modules/registry/__tests__/pos-manifests.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getModule, allModules } from '../modules';
import { getProduct, allProducts } from '../products';
import { POS_ACTIONS } from '../types';

describe('pos registry entries', () => {
  it('module is registered with key=pos', () => {
    const m = getModule('pos');
    expect(m).toBeDefined();
    expect(m?.key).toBe('pos');
    expect(m?.vendor_side).toBe(true);
    expect(m?.customer_side).toBe(false);
  });
  it('product is registered with requires=["products"]', () => {
    const p = getProduct('pos');
    expect(p).toBeDefined();
    expect(p?.requires).toEqual(['products']);
    expect(p?.permissions.map((x) => x.key.replace(/^pos\./, ''))).toEqual([...POS_ACTIONS]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `getModule('pos')` returns undefined.

- [ ] **Step 3: Add `ProductManifest.requires` to types**

Modify `src/modules/registry/types.ts` to add the field on the existing `ProductManifest` interface:
```ts
export interface ProductManifest {
  key: string;
  label: string;
  modules: ReadonlyArray<{ module: ModuleKey; side: ProductModuleSide }>;
  requires?: ReadonlyArray<string>;
  permissions?: ReadonlyArray<{ key: PermissionKey; label: string }>;
}
```

- [ ] **Step 4: Create `src/modules/registry/manifests/pos.ts`**

```ts
import type { ModuleManifest } from '../types';

export const posManifest: ModuleManifest = {
  key: 'pos',
  label: 'POS',
  data_buckets: [],         // POS does not own a CRUD bucket; uses pos.* keys instead
  verbs: [],
  vendor_side: true,
  customer_side: false,
};
```

- [ ] **Step 5: Create `src/modules/registry/products-list/pos.ts`**

```ts
import type { ProductManifest, PermissionKey } from '../types';
import { POS_ACTIONS } from '../types';

export const posProduct: ProductManifest = {
  key: 'pos',
  label: 'POS',
  modules: [{ module: 'pos', side: 'vendor' }],
  requires: ['products'],
  permissions: POS_ACTIONS.map((a) => ({
    key: `pos.${a}` as PermissionKey,
    label: actionLabel(a),
  })),
};

function actionLabel(a: typeof POS_ACTIONS[number]): string {
  switch (a) {
    case 'menu.view':       return 'View menu / add to cart';
    case 'sale.create':     return 'Submit cart (creates pending sale)';
    case 'sale.markPaid':   return 'Mark sale paid (cash)';
    case 'sale.fulfill':    return 'Mark sale fulfilled (pickup/online)';
    case 'sale.cancel':     return 'Cancel pending sale';
    case 'sale.refund':     return 'Refund a paid/fulfilled sale';
    case 'history.view':    return 'View own sale history';
    case 'history.viewAll': return 'View all sales (any cashier)';
  }
}
```

- [ ] **Step 6: Register in `modules.ts` and `products.ts`**

Append imports + entries (do not remove existing keys):
```ts
// src/modules/registry/modules.ts
import { posManifest } from './manifests/pos';
// ...inside moduleRegistry:
  pos: posManifest,

// src/modules/registry/products.ts
import { posProduct } from './products-list/pos';
// ...inside productRegistry:
  'pos': posProduct,
```

- [ ] **Step 7: Run to verify PASS + typecheck**

```
npx vitest run src/modules/registry/__tests__/pos-manifests.spec.ts
npm run typecheck
```

- [ ] **Step 8: Commit**

```
git add src/modules/registry
git commit -m "feat(registry): add pos module + product manifest with 8 permissions"
```

---

### Task 3: Migration 040 — `sales` table

**Files:**
- Create: `db/migrations/040_sales.sql`
- Test: `tests/pos/migration-040.spec.ts` (create)

- [ ] **Step 1: Failing test**

Create `tests/pos/migration-040.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { db } from '../../netlify/functions/_shared/db';

describe('migration 040 — sales table', () => {
  it('has the expected columns and constraints', async () => {
    const sql = db();
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sales'
      ORDER BY ordinal_position
    ` as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    const names = cols.map(c => c.column_name);
    for (const expected of [
      'id', 'bucket_id', 'order_no', 'status', 'channel',
      'customer_name', 'customer_phone', 'customer_email',
      'subtotal_cents', 'discount_cents', 'tax_cents', 'total_cents',
      'created_by_user_node', 'created_at',
      'paid_at', 'fulfilled_at', 'cancelled_at', 'refunded_at',
      'payment_method', 'payment_ref',
    ]) expect(names).toContain(expected);
  });
  it('rejects empty customer_phone', async () => {
    const sql = db();
    await expect(sql`
      INSERT INTO public.sales
        (bucket_id, order_no, channel, customer_name, customer_phone,
         subtotal_cents, total_cents, created_by_user_node)
      VALUES
        (gen_random_uuid(), 1, 'instore', 'X', '   ', 0, 0, gen_random_uuid())
    `).rejects.toThrow(/sales_phone_not_empty/);
  });
});
```

(Note: `tests/pos/` integration tests run against a real Postgres pointed at by `DATABASE_URL` in `.env.test`. If `tests/setup.ts` doesn't exist with that wiring already, see Task 6 for the setup file.)

- [ ] **Step 2: Run to verify FAIL** — `sales` table doesn't exist yet.

- [ ] **Step 3: Write `db/migrations/040_sales.sql`**

Use the exact DDL from spec §4.2:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE public.sale_status  AS ENUM ('pending_payment','paid','fulfilled','cancelled','refunded');
CREATE TYPE public.sale_channel AS ENUM ('instore','online','pickup');

CREATE TABLE public.sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id       UUID NOT NULL,    -- references clients(id) — see note below
  order_no        INT  NOT NULL,
  status          public.sale_status  NOT NULL DEFAULT 'pending_payment',
  channel         public.sale_channel NOT NULL,

  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,

  subtotal_cents  BIGINT NOT NULL,
  discount_cents  BIGINT NOT NULL DEFAULT 0,
  tax_cents       BIGINT NOT NULL DEFAULT 0,
  total_cents     BIGINT NOT NULL,

  created_by_user_node UUID NOT NULL REFERENCES public.user_nodes(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ,
  fulfilled_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ,

  payment_method  TEXT,
  payment_ref     TEXT,

  CONSTRAINT sales_bucket_fk FOREIGN KEY (bucket_id) REFERENCES public.clients(id) ON DELETE CASCADE,
  CONSTRAINT sales_order_no_per_bucket UNIQUE (bucket_id, order_no),
  CONSTRAINT sales_phone_not_empty CHECK (length(trim(customer_phone)) > 0),
  CONSTRAINT sales_name_not_empty  CHECK (length(trim(customer_name))  > 0),
  CONSTRAINT sales_total_matches   CHECK (total_cents = subtotal_cents - discount_cents + tax_cents)
);

CREATE INDEX idx_sales_bucket_created   ON public.sales(bucket_id, created_at DESC);
CREATE INDEX idx_sales_bucket_status    ON public.sales(bucket_id, status);
CREATE INDEX idx_sales_bucket_channel   ON public.sales(bucket_id, channel);
CREATE INDEX idx_sales_bucket_creator   ON public.sales(bucket_id, created_by_user_node, created_at DESC);
CREATE INDEX idx_sales_phone_trgm       ON public.sales USING gin (customer_phone gin_trgm_ops);
```

**Note:** "bucket" in the codebase = `clients` table. Spec's `bucket_id REFERENCES buckets(id)` is conceptual; the actual FK target is `public.clients(id)`. This task uses the real table name.

- [ ] **Step 4: Apply against local dev DB**

```
npm run migrate
```
Expected: "Applied 040_sales.sql" (or the script's success format).

- [ ] **Step 5: Run test to verify PASS**

```
npx vitest run tests/pos/migration-040.spec.ts
```

- [ ] **Step 6: Commit**

```
git add db/migrations/040_sales.sql tests/pos/migration-040.spec.ts
git commit -m "feat(db): migration 040 — sales table with FSM enums + indexes"
```

---

### Task 4: Migration 041 — `sale_lines` table

**Files:**
- Create: `db/migrations/041_sale_lines.sql`
- Test: `tests/pos/migration-041.spec.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/pos/migration-041.spec.ts
import { describe, it, expect } from 'vitest';
import { db } from '../../netlify/functions/_shared/db';

describe('migration 041 — sale_lines table', () => {
  it('has cascade delete from sales and restrict from products', async () => {
    const sql = db();
    const fks = await sql`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conrelid = 'public.sale_lines'::regclass AND contype = 'f'
    ` as Array<{ conname: string; confdeltype: string }>;
    // confdeltype: 'c' = CASCADE, 'r' = RESTRICT
    const saleFk    = fks.find(f => f.conname.includes('sale'));
    const productFk = fks.find(f => f.conname.includes('product'));
    expect(saleFk?.confdeltype).toBe('c');
    expect(productFk?.confdeltype).toBe('r');
  });
  it('rejects qty <= 0', async () => {
    const sql = db();
    await expect(sql`
      INSERT INTO public.sale_lines (sale_id, product_id, product_name_snap,
        unit_price_cents, qty, line_total_cents, position)
      VALUES (gen_random_uuid(), gen_random_uuid(), 'X', 100, 0, 0, 0)
    `).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Write `db/migrations/041_sale_lines.sql`**

```sql
CREATE TABLE public.sale_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id             UUID NOT NULL REFERENCES public.sales(id)    ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snap   TEXT   NOT NULL,
  unit_price_cents    BIGINT NOT NULL,
  qty                 INT    NOT NULL CHECK (qty > 0),
  line_total_cents    BIGINT NOT NULL,
  position            INT    NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sale_lines_total_matches CHECK (line_total_cents = unit_price_cents * qty)
);

CREATE INDEX idx_sale_lines_sale ON public.sale_lines(sale_id, position);
```

- [ ] **Step 4: Apply + verify PASS**

```
npm run migrate && npx vitest run tests/pos/migration-041.spec.ts
```

- [ ] **Step 5: Commit**

```
git add db/migrations/041_sale_lines.sql tests/pos/migration-041.spec.ts
git commit -m "feat(db): migration 041 — sale_lines with snapshot pricing"
```

---

### Task 5: Migration 042 — Enable `pos` product for existing clients (idempotent)

This migration backfills `client_enabled_products` so existing clients with `products` enabled also get `pos` enabled by default. Reversible by manual UPDATE; intentionally idempotent so re-running is safe.

**Files:**
- Create: `db/migrations/042_enable_pos_product.sql`
- Test: `tests/pos/migration-042.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { db } from '../../netlify/functions/_shared/db';

describe('migration 042 — enable pos product', () => {
  it('inserts a pos row for every client that has products enabled', async () => {
    const sql = db();
    const mismatched = await sql`
      SELECT c.client_id
      FROM public.client_enabled_products c
      WHERE c.product_key = 'products'
        AND NOT EXISTS (
          SELECT 1 FROM public.client_enabled_products c2
          WHERE c2.client_id = c.client_id AND c2.product_key = 'pos'
        )
    ` as Array<{ client_id: string }>;
    expect(mismatched).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (if there are clients with `products` enabled but no `pos`).

- [ ] **Step 3: Write `db/migrations/042_enable_pos_product.sql`**

```sql
INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
SELECT cep.client_id, 'pos', cep.enabled_by_admin
FROM public.client_enabled_products cep
WHERE cep.product_key = 'products'
ON CONFLICT (client_id, product_key) DO NOTHING;
```

- [ ] **Step 4: Apply + verify PASS**

- [ ] **Step 5: Commit**

```
git add db/migrations/042_enable_pos_product.sql tests/pos/migration-042.spec.ts
git commit -m "feat(db): migration 042 — enable pos product for clients with products"
```

---

### Task 6: Tests setup (skip if `tests/setup.ts` already exists)

**Goal:** ensure `tests/pos/*` can hit a real Postgres. If `tests/setup.ts` already exists (check via `cat tests/setup.ts`), skip this task entirely and verify only the `pos` test folder is included by `vitest.config.ts`.

If absent, this task creates a minimal setup file that runs migrations against a test DB before the suite.

**Files:**
- Possibly create: `tests/pos/setup.ts`
- Possibly modify: `vitest.config.ts`

- [ ] **Step 1: Check existing setup**

```
cat tests/setup.ts 2>/dev/null && echo "EXISTS — skip rest of task" || echo "MISSING — continue"
```

- [ ] **Step 2 (only if MISSING): Create `tests/pos/setup.ts`**

```ts
// Loads .env.test (DATABASE_URL must point at a throwaway DB).
import 'dotenv/config';
import { beforeAll } from 'vitest';
import { execSync } from 'node:child_process';

beforeAll(() => {
  execSync('npm run migrate', { stdio: 'inherit' });
}, 120_000);
```

- [ ] **Step 3 (only if MISSING): Wire into `vitest.config.ts`**

Add `setupFiles: ['tests/pos/setup.ts']` to the `test` block in `vitest.config.ts`.

- [ ] **Step 4: Commit (only if files changed)**

```
git add tests/pos/setup.ts vitest.config.ts
git commit -m "test(pos): add migration setup for integration tests"
```

---

## Phase 2 — Backend pure libs (Tasks 7–8)

These two libs (validators + FSM) carry the business rules and are imported by all 5 endpoint handlers. Built first, in isolation, so the endpoints can be thin orchestration layers.

### Task 7: `_validators.ts` — zod schemas for all POS request bodies

**Files:**
- Create: `netlify/functions/pos/_validators.ts`
- Create: `netlify/functions/pos/__tests__/validators.spec.ts`

- [ ] **Step 1: Failing test**

```ts
// netlify/functions/pos/__tests__/validators.spec.ts
import { describe, it, expect } from 'vitest';
import { SaleCreateBody, SaleStateBody, SalesListQuery } from '../_validators';

describe('SaleCreateBody', () => {
  const valid = {
    channel: 'instore', idempotencyKey: 'a'.repeat(20),
    customer: { name: 'R', phone: '9' },
    lines: [{ productId: '00000000-0000-0000-0000-000000000001', qty: 1 }],
  };
  it('accepts a valid body', () => expect(() => SaleCreateBody.parse(valid)).not.toThrow());
  it('rejects empty lines', () => expect(() => SaleCreateBody.parse({ ...valid, lines: [] })).toThrow());
  it('rejects qty <= 0', () => expect(() => SaleCreateBody.parse({
    ...valid, lines: [{ productId: valid.lines[0].productId, qty: 0 }],
  })).toThrow());
  it('rejects blank phone', () => expect(() => SaleCreateBody.parse({
    ...valid, customer: { name: 'R', phone: '   ' },
  })).toThrow());
});

describe('SaleStateBody', () => {
  it.each(['markPaid','fulfill','cancel','refund'] as const)('accepts %s', (a) =>
    expect(() => SaleStateBody.parse({ action: a })).not.toThrow());
  it('rejects unknown action', () =>
    expect(() => SaleStateBody.parse({ action: 'zorp' })).toThrow());
});

describe('SalesListQuery', () => {
  it('parses CSV status', () => {
    const q = SalesListQuery.parse({ status: 'paid,fulfilled' });
    expect(q.status).toEqual(['paid', 'fulfilled']);
  });
  it('defaults date range to today when both omitted', () => {
    const q = SalesListQuery.parse({});
    expect(q.from).toBeDefined();
    expect(q.to).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create `netlify/functions/pos/_validators.ts`**

```ts
import { z } from 'zod';

const Uuid = z.string().uuid();
const Channel = z.enum(['instore', 'online', 'pickup']);
const Status  = z.enum(['pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded']);
const NonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be blank');

export const SaleCreateBody = z.object({
  channel: Channel,
  idempotencyKey: z.string().min(8).max(64),
  customer: z.object({
    name: NonBlank,
    phone: NonBlank,
    email: z.string().email().optional(),
  }),
  lines: z.array(z.object({
    productId: Uuid,
    qty: z.number().int().positive(),
  })).min(1),
});
export type SaleCreateBody = z.infer<typeof SaleCreateBody>;

export const SaleStateBody = z.object({
  action: z.enum(['markPaid', 'fulfill', 'cancel', 'refund']),
  paymentMethod: z.enum(['cash']).optional(),
  reason: z.string().max(500).optional(),
});
export type SaleStateBody = z.infer<typeof SaleStateBody>;

const csv = <T extends z.ZodEnum<any>>(e: T) =>
  z.string().optional().transform((v) => v ? v.split(',') as Array<z.infer<T>> : undefined)
   .pipe(z.array(e).optional());

const todayIso = () => new Date().toISOString().slice(0, 10);

export const SalesListQuery = z.object({
  status:  csv(Status),
  channel: csv(Channel),
  cashier: Uuid.optional(),
  from: z.string().optional().transform((v) => v ?? todayIso()),
  to:   z.string().optional().transform((v) => v ?? todayIso()),
  q: z.string().optional(),
  limit:  z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type SalesListQuery = z.infer<typeof SalesListQuery>;
```

- [ ] **Step 4: Run to verify PASS + typecheck**

```
npx vitest run netlify/functions/pos/__tests__/validators.spec.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```
git add netlify/functions/pos/_validators.ts netlify/functions/pos/__tests__/validators.spec.ts
git commit -m "feat(pos): zod validators for sale-create / sale-state / sales-list"
```

---

### Task 8: `_fsm.ts` — server-side state-machine guards (pure)

Captures the §5.2 permission × state matrix as a pure data table and a single `applyTransition` helper. Handler code stays thin.

**Files:**
- Create: `netlify/functions/pos/_fsm.ts`
- Create: `netlify/functions/pos/__tests__/fsm.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { applyTransition, FSM_ERROR, type SaleStatus } from '../_fsm';

const perms = (...keys: string[]) => new Set(keys);

describe('applyTransition', () => {
  it('pending_payment + markPaid + perm + instore → fulfilled (auto)', () => {
    const r = applyTransition({
      from: 'pending_payment', channel: 'instore',
      action: 'markPaid', perms: perms('pos.sale.markPaid'),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.to).toBe('fulfilled');
      expect(r.alsoPaid).toBe(true);
    }
  });
  it('pending_payment + markPaid + perm + pickup → paid (no auto-fulfill)', () => {
    const r = applyTransition({
      from: 'pending_payment', channel: 'pickup',
      action: 'markPaid', perms: perms('pos.sale.markPaid'),
    });
    expect(r.ok && r.to).toBe('paid');
  });
  it('error precedence: missing perm wins over illegal state', () => {
    const r = applyTransition({
      from: 'paid', channel: 'instore',  // illegal: can't markPaid an already-paid
      action: 'markPaid', perms: perms(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(FSM_ERROR.MISSING_PERM);
  });
  it.each([
    ['fulfill', 'paid',     'fulfilled', 'pos.sale.fulfill'],
    ['cancel',  'pending_payment', 'cancelled', 'pos.sale.cancel'],
    ['refund',  'paid',     'refunded',  'pos.sale.refund'],
    ['refund',  'fulfilled','refunded',  'pos.sale.refund'],
  ] as const)('%s from %s → %s', (action, from, to, perm) => {
    const r = applyTransition({ from, channel: 'instore', action, perms: perms(perm) });
    expect(r.ok && r.to).toBe(to);
  });
  it.each([
    ['markPaid', 'fulfilled'],
    ['fulfill',  'pending_payment'],
    ['cancel',   'paid'],
    ['refund',   'pending_payment'],
  ] as const)('illegal: %s from %s → 409', (action, from) => {
    const r = applyTransition({
      from, channel: 'instore', action,
      perms: perms('pos.sale.markPaid','pos.sale.fulfill','pos.sale.cancel','pos.sale.refund'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(FSM_ERROR.ILLEGAL_TRANSITION);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create `netlify/functions/pos/_fsm.ts`**

```ts
export type SaleStatus = 'pending_payment'|'paid'|'fulfilled'|'cancelled'|'refunded';
export type SaleChannel = 'instore'|'online'|'pickup';
export type FsmAction = 'markPaid'|'fulfill'|'cancel'|'refund';

export const FSM_ERROR = {
  MISSING_PERM: 'missing_perm',
  ILLEGAL_TRANSITION: 'illegal_transition',
} as const;
export type FsmError = (typeof FSM_ERROR)[keyof typeof FSM_ERROR];

const PERM: Record<FsmAction, string> = {
  markPaid: 'pos.sale.markPaid',
  fulfill:  'pos.sale.fulfill',
  cancel:   'pos.sale.cancel',
  refund:   'pos.sale.refund',
};

const ALLOWED_FROM: Record<FsmAction, readonly SaleStatus[]> = {
  markPaid: ['pending_payment'],
  fulfill:  ['paid'],
  cancel:   ['pending_payment'],
  refund:   ['paid', 'fulfilled'],
};

const NATURAL_TO: Record<FsmAction, SaleStatus> = {
  markPaid: 'paid',
  fulfill:  'fulfilled',
  cancel:   'cancelled',
  refund:   'refunded',
};

export interface TransitionInput {
  from: SaleStatus;
  channel: SaleChannel;
  action: FsmAction;
  perms: ReadonlySet<string>;
}
export type TransitionResult =
  | { ok: true; to: SaleStatus; alsoPaid: boolean }      // alsoPaid=true only on instore+markPaid auto-fulfill
  | { ok: false; code: FsmError };

export function applyTransition(i: TransitionInput): TransitionResult {
  // §5.3 precedence — perm check FIRST so 403 wins over 409.
  if (!i.perms.has(PERM[i.action])) return { ok: false, code: FSM_ERROR.MISSING_PERM };
  if (!ALLOWED_FROM[i.action].includes(i.from)) return { ok: false, code: FSM_ERROR.ILLEGAL_TRANSITION };
  let to = NATURAL_TO[i.action];
  let alsoPaid = false;
  if (i.action === 'markPaid' && i.channel === 'instore') {
    // §5.1 — instore + markPaid auto-fulfills.
    to = 'fulfilled';
    alsoPaid = true;
  }
  return { ok: true, to, alsoPaid };
}
```

- [ ] **Step 4: Run to verify PASS + typecheck**

- [ ] **Step 5: Commit**

```
git add netlify/functions/pos/_fsm.ts netlify/functions/pos/__tests__/fsm.spec.ts
git commit -m "feat(pos): server-side FSM with perm precedence + instore auto-fulfill"
```

---

## Phase 3 — Backend endpoints (Tasks 9–13)

Each task: handler + integration test in one go. All five share an auth + permission check pattern; we extract a small `_authz.ts` helper inside the first endpoint task to avoid duplication.

### Task 9: `GET /api/pos/menu`

**Files:**
- Create: `netlify/functions/pos/_authz.ts`
- Create: `netlify/functions/pos/menu.ts`
- Create: `tests/pos/menu.spec.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/pos/menu.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos/menu';
import { makeBucketUserRequest, seedBucketWithProductsEnabled, seedProducts,
         disableProductsForBucket, grantPerms } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedBucketWithProductsEnabled>>;
beforeAll(async () => { ctx = await seedBucketWithProductsEnabled(); });

describe('GET /api/pos/menu', () => {
  it('returns products filtered by pos_visible=true', async () => {
    await seedProducts(ctx.bucket, [
      { name: 'Cappuccino', sale_price_cents: 22000, pos_visible: true },
      { name: 'Backstage SKU', sale_price_cents: 5000, pos_visible: false },
    ]);
    await grantPerms(ctx.userNode, ['pos.menu.view']);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.products.map((p: any) => p.name)).toEqual(['Cappuccino']);
  });
  it('returns 412 when products module not enabled', async () => {
    await disableProductsForBucket(ctx.bucket);
    await grantPerms(ctx.userNode, ['pos.menu.view']);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(412);
  });
  it('returns 403 without pos.menu.view', async () => {
    await grantPerms(ctx.userNode, []);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(res.status).toBe(403);
  });
});
```

**Helper expectations:** `tests/pos/_helpers.ts` will be created in Step 3 below — single file used by all 5 endpoint tests.

- [ ] **Step 2: Create `tests/pos/_helpers.ts`**

```ts
// Minimal helpers for POS endpoint integration tests.
// Reuses existing _shared/session for JWT issuance.
import { db } from '../../netlify/functions/_shared/db';
import { signBucketUserSession } from '../../netlify/functions/_shared/session';

export interface PosTestCtx {
  bucket: string;          // = clients(id)
  userNode: string;        // user_nodes(id)
  cookie: string;
}

export async function seedBucketWithProductsEnabled(): Promise<PosTestCtx> {
  const sql = db();
  const [{ id: bucket }] = (await sql`
    INSERT INTO public.clients (name, slug) VALUES ('POS Test',
      'pos-test-' || substr(gen_random_uuid()::text, 1, 8))
    RETURNING id
  `) as Array<{ id: string }>;
  const [{ id: userNode }] = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_user_node_id, level, name)
    VALUES (${bucket}, NULL, 1, 'Owner')
    RETURNING id
  `) as Array<{ id: string }>;
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${bucket}, 'products'), (${bucket}, 'pos')
  `;
  const token = await signBucketUserSession({ sub: userNode, client_id: bucket });
  return { bucket, userNode, cookie: `bu_session=${token}` };
}

export async function seedProducts(
  bucket: string,
  products: Array<{ name: string; sale_price_cents: number; pos_visible: boolean }>,
): Promise<string[]> {
  const sql = db();
  const ids: string[] = [];
  for (const p of products) {
    const [{ id }] = (await sql`
      INSERT INTO public.products (bucket_id, name, sale_price_cents, pos_visible)
      VALUES (${bucket}, ${p.name}, ${p.sale_price_cents}, ${p.pos_visible})
      RETURNING id
    `) as Array<{ id: string }>;
    ids.push(id);
  }
  return ids;
}

export async function disableProductsForBucket(bucket: string): Promise<void> {
  await db()`DELETE FROM public.client_enabled_products WHERE client_id = ${bucket} AND product_key = 'products'`;
}

export async function grantPerms(userNode: string, keys: string[]): Promise<void> {
  // Sets permissions on the user_node's effective level. Concrete shape depends on
  // _shared/permissions.ts — we attach a level row with the given JSONB keys.
  const sql = db();
  const perms = Object.fromEntries(keys.map((k) => [k, true]));
  await sql`
    INSERT INTO public.client_levels (client_id, user_node_id, permissions)
    VALUES ((SELECT client_id FROM public.user_nodes WHERE id = ${userNode}),
            ${userNode}, ${JSON.stringify(perms)}::jsonb)
    ON CONFLICT (user_node_id) DO UPDATE SET permissions = EXCLUDED.permissions
  `;
}

export function makeBucketUserRequest(ctx: PosTestCtx, method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method, headers: { Cookie: ctx.cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}
```

**Note for the implementer:** if `client_levels` shape doesn't match (e.g., no `user_node_id` column — could be a `level_id` lookup instead), inspect the migration 021 file and adjust `grantPerms`. The `permissions` JSONB shape is the stable contract; the row identity may differ.

- [ ] **Step 3: Run test to verify FAIL** — `pos/menu.ts` doesn't exist.

- [ ] **Step 4: Create `netlify/functions/pos/_authz.ts`**

```ts
import { jsonError } from '../_shared/http';
import { requireBucketUser } from '../_shared/permissions';
import { db } from '../_shared/db';

export interface PosAuthCtx {
  userNodeId: string;
  bucketId: string;
  perms: ReadonlySet<string>;
}

/**
 * Resolves the bucket-user session, loads their permission set, and verifies
 * the bucket has both 'products' and 'pos' enabled. Returns either a Response
 * to bail with, or the ctx to continue.
 */
export async function requirePos(req: Request, required: readonly string[]): Promise<
  | { ok: true; ctx: PosAuthCtx }
  | { ok: false; res: Response }
> {
  try {
    const { credential, claims } = await requireBucketUser(req);
    const sql = db();
    const rows = (await sql`
      SELECT permissions FROM public.client_levels
      WHERE user_node_id = ${credential.user_node_id} LIMIT 1
    `) as Array<{ permissions: Record<string, boolean> }>;
    const perms = new Set(Object.entries(rows[0]?.permissions ?? {}).filter(([_, v]) => v).map(([k]) => k));

    // 412 if PM disabled for this bucket
    const enabled = (await sql`
      SELECT product_key FROM public.client_enabled_products
      WHERE client_id = ${claims.client_id}
    `) as Array<{ product_key: string }>;
    const keys = new Set(enabled.map((e) => e.product_key));
    if (!keys.has('products')) {
      return { ok: false, res: jsonError(412, 'products_module_required') };
    }
    if (!keys.has('pos')) {
      return { ok: false, res: jsonError(412, 'pos_module_not_enabled') };
    }
    for (const r of required) {
      if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
    }
    return { ok: true, ctx: { userNodeId: credential.user_node_id, bucketId: claims.client_id, perms } };
  } catch {
    return { ok: false, res: jsonError(401, 'unauthorized') };
  }
}
```

- [ ] **Step 5: Create `netlify/functions/pos/menu.ts`**

```ts
import { jsonOk } from '../_shared/http';
import { db } from '../_shared/db';
import { requirePos } from './_authz';

export const config = { path: '/api/pos/menu' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.menu.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const products = (await sql`
    SELECT id, name, category_id, sale_price_cents,
           thumb_url
    FROM public.products
    WHERE bucket_id = ${a.ctx.bucketId} AND pos_visible = true
    ORDER BY category_id NULLS LAST, name
  `) as Array<{ id: string; name: string; category_id: string|null;
                sale_price_cents: number; thumb_url: string|null }>;

  const cats = (await sql`
    SELECT id, name FROM public.product_categories WHERE bucket_id = ${a.ctx.bucketId} ORDER BY name
  `) as Array<{ id: string; name: string }>;

  return jsonOk({
    categories: cats.map((c) => ({
      id: c.id, name: c.name,
      productCount: products.filter((p) => p.category_id === c.id).length,
    })),
    products: products.map((p) => ({
      id: p.id, name: p.name, categoryId: p.category_id,
      salePriceCents: p.sale_price_cents, thumbUrl: p.thumb_url,
    })),
  });
}
```

**Implementer note:** column names like `thumb_url` / `category_id` must match the actual `products` schema. Verify via `\d public.products` before coding; adjust SELECT list to match real names (likely `product_categories.id` and `products.category_id` are the convention, but confirm).

- [ ] **Step 6: Run test to verify PASS + typecheck**

- [ ] **Step 7: Commit**

```
git add netlify/functions/pos/_authz.ts netlify/functions/pos/menu.ts tests/pos/_helpers.ts tests/pos/menu.spec.ts
git commit -m "feat(pos): GET /api/pos/menu — filtered by pos_visible, perm + dependency gated"
```

---

### Task 10: `POST /api/pos/sales`

This is the densest handler — idempotency, server-side price snapshot, per-bucket `order_no` allocation, sale + lines insert, audit write.

**Files:**
- Create: `netlify/functions/pos/sale-create.ts`
- Create: `tests/pos/sale-create.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos/sale-create';
import { db } from '../../netlify/functions/_shared/db';
import { seedBucketWithProductsEnabled, seedProducts, grantPerms, makeBucketUserRequest } from './_helpers';

let ctx: any, capId: string, pastaId: string;
beforeAll(async () => {
  ctx = await seedBucketWithProductsEnabled();
  const ids = await seedProducts(ctx.bucket, [
    { name: 'Cappuccino', sale_price_cents: 22000, pos_visible: true },
    { name: 'Pasta',      sale_price_cents: 52000, pos_visible: true },
  ]);
  [capId, pastaId] = ids;
  await grantPerms(ctx.userNode, ['pos.sale.create']);
});

const validBody = () => ({
  channel: 'instore' as const,
  idempotencyKey: crypto.randomUUID(),
  customer: { name: 'Riya', phone: '9876543210' },
  lines: [{ productId: capId, qty: 2 }, { productId: pastaId, qty: 1 }],
});

describe('POST /api/pos/sales', () => {
  it('creates pending_payment sale with server-snapshot prices', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', validBody()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending_payment');
    expect(body.subtotal_cents).toBe(2 * 22000 + 52000);
    expect(body.order_no).toBeGreaterThanOrEqual(1);
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0].unit_price_cents).toBe(22000);   // snapshot
  });

  it('rejects empty lines with 400', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales',
      { ...validBody(), lines: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects unknown product with 400', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales',
      { ...validBody(), lines: [{ productId: '00000000-0000-0000-0000-000000000000', qty: 1 }] }));
    expect(res.status).toBe(400);
  });

  it('returns 404 for cross-bucket product (leak prevention)', async () => {
    const other = await seedBucketWithProductsEnabled();
    const [otherProduct] = await seedProducts(other.bucket,
      [{ name: 'Other', sale_price_cents: 100, pos_visible: true }]);
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales',
      { ...validBody(), lines: [{ productId: otherProduct, qty: 1 }] }));
    expect(res.status).toBe(404);
  });

  it('idempotent: same key returns same sale', async () => {
    const body = validBody();
    const r1 = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', body));
    const r2 = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', body));
    const a = await r1.json(), b = await r2.json();
    expect(a.id).toBe(b.id);
    expect(r1.status).toBe(201); expect(r2.status).toBe(200);   // second is "already exists"
  });

  it('allocates order_no monotonically per bucket under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', validBody()))));
    const nos = (await Promise.all(results.map((r) => r.json()))).map((b: any) => b.order_no).sort();
    // All distinct
    expect(new Set(nos).size).toBe(nos.length);
  });

  it('returns 403 without pos.sale.create', async () => {
    await grantPerms(ctx.userNode, []);
    const res = await handler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', validBody()));
    expect(res.status).toBe(403);
    await grantPerms(ctx.userNode, ['pos.sale.create']); // restore
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create `netlify/functions/pos/sale-create.ts`**

```ts
import { jsonOk, jsonError } from '../_shared/http';
import { db } from '../_shared/db';
import { logAudit } from '../_shared/audit';
import { requirePos } from './_authz';
import { SaleCreateBody } from './_validators';

export const config = { path: '/api/pos/sales' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.sale.create']);
  if (!a.ok) return a.res;

  let body: SaleCreateBody;
  try { body = SaleCreateBody.parse(await req.json()); }
  catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }

  const sql = db();
  const { bucketId, userNodeId } = a.ctx;

  // Idempotency: was this key already used by this user in the last 24h?
  const existing = (await sql`
    SELECT id FROM public.sales
    WHERE bucket_id = ${bucketId}
      AND created_by_user_node = ${userNodeId}
      AND payment_ref = ${'idem:' + body.idempotencyKey}
      AND created_at > now() - interval '24 hours'
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing[0]) {
    const full = await loadSaleResponse(sql, existing[0].id);
    return jsonOk(full, { status: 200 });
  }

  // Load products with snapshot data. Cross-bucket or missing → 404.
  const productIds = body.lines.map((l) => l.productId);
  const products = (await sql`
    SELECT id, name, sale_price_cents, bucket_id, pos_visible
    FROM public.products
    WHERE id = ANY(${productIds}::uuid[])
  `) as Array<{ id: string; name: string; sale_price_cents: number;
                bucket_id: string; pos_visible: boolean }>;

  if (products.length !== productIds.length) return jsonError(400, 'unknown_product');
  if (products.some((p) => p.bucket_id !== bucketId)) return jsonError(404, 'product_not_found');
  if (products.some((p) => !p.pos_visible)) return jsonError(400, 'product_not_visible');

  const byId = new Map(products.map((p) => [p.id, p]));

  // Compute totals from server-side prices (snapshot semantics).
  let subtotal = 0;
  const lineSpecs = body.lines.map((l, idx) => {
    const p = byId.get(l.productId)!;
    const lineTotal = p.sale_price_cents * l.qty;
    subtotal += lineTotal;
    return {
      productId: p.id, productName: p.name,
      unitPriceCents: p.sale_price_cents, qty: l.qty,
      lineTotalCents: lineTotal, position: idx,
    };
  });
  const total = subtotal; // discount/tax 0 in v1

  // Transaction: allocate order_no + insert sale + insert lines.
  // Neon serverless doesn't expose multi-statement tx via the http driver,
  // so we use a single CTE chain.
  const inserted = (await sql`
    WITH next AS (
      SELECT COALESCE(MAX(order_no), 0) + 1 AS n
      FROM public.sales
      WHERE bucket_id = ${bucketId}
    ),
    new_sale AS (
      INSERT INTO public.sales (
        bucket_id, order_no, status, channel,
        customer_name, customer_phone, customer_email,
        subtotal_cents, total_cents,
        created_by_user_node, payment_ref
      )
      SELECT ${bucketId}, n, 'pending_payment', ${body.channel},
             ${body.customer.name}, ${body.customer.phone}, ${body.customer.email ?? null},
             ${subtotal}, ${total},
             ${userNodeId}, ${'idem:' + body.idempotencyKey}
      FROM next
      RETURNING *
    )
    SELECT * FROM new_sale
  `) as Array<{ id: string; order_no: number }>;

  const saleId = inserted[0].id;

  // Bulk insert lines.
  for (const ls of lineSpecs) {
    await sql`
      INSERT INTO public.sale_lines
        (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}, ${ls.productId}, ${ls.productName}, ${ls.unitPriceCents},
         ${ls.qty}, ${ls.lineTotalCents}, ${ls.position})
    `;
  }

  await logAudit(sql, {
    session: { kind: 'bucket_user', user_node_id: userNodeId } as any,
    op: 'pos.sale.created',
    clientId: bucketId, targetType: 'sale', targetId: saleId,
    detail: { total, channel: body.channel, lines: lineSpecs.length },
  });

  return jsonOk(await loadSaleResponse(sql, saleId), { status: 201 });
}

async function loadSaleResponse(sql: ReturnType<typeof db>, saleId: string) {
  const [sale] = (await sql`SELECT * FROM public.sales WHERE id = ${saleId}`) as any[];
  const lines = (await sql`
    SELECT * FROM public.sale_lines WHERE sale_id = ${saleId} ORDER BY position
  `) as any[];
  return { ...sale, lines };
}
```

**Concurrency note for implementer:** the `MAX(order_no) + 1` CTE may race under high concurrency. The `UNIQUE (bucket_id, order_no)` constraint catches collisions — handle by detecting `23505` and retrying once (up to 3 attempts). Add a retry wrapper if the 5-parallel test from the spec fails.

- [ ] **Step 4: Run to verify PASS + typecheck**

- [ ] **Step 5: Commit**

```
git add netlify/functions/pos/sale-create.ts tests/pos/sale-create.spec.ts
git commit -m "feat(pos): POST /api/pos/sales — snapshot prices, idempotent, per-bucket order_no"
```

---

### Task 11: `GET /api/pos/sales` (list)

**Files:**
- Create: `netlify/functions/pos/sales-list.ts`
- Create: `tests/pos/sales-list.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos/sales-list';
import createHandler from '../../netlify/functions/pos/sale-create';
import { seedBucketWithProductsEnabled, seedProducts, grantPerms, makeBucketUserRequest } from './_helpers';

let ctx: any, productId: string;
beforeAll(async () => {
  ctx = await seedBucketWithProductsEnabled();
  [productId] = await seedProducts(ctx.bucket,
    [{ name: 'X', sale_price_cents: 100, pos_visible: true }]);
  await grantPerms(ctx.userNode, ['pos.sale.create', 'pos.history.view', 'pos.history.viewAll']);
  for (let i = 0; i < 3; i++) {
    await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'instore', idempotencyKey: crypto.randomUUID(),
      customer: { name: 'A', phone: '1' },
      lines: [{ productId, qty: 1 }],
    }));
  }
});

describe('GET /api/pos/sales', () => {
  it('returns sales with summary block', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sales.length).toBeGreaterThanOrEqual(3);
    expect(body.summary.count).toBe(body.sales.length);
  });

  it('without viewAll, scopes to own sales', async () => {
    await grantPerms(ctx.userNode, ['pos.history.view']); // drop viewAll
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales?cashier=00000000-0000-0000-0000-000000000999'));
    const body = await res.json();
    // Server forces cashier = current user, ignores query param
    expect(body.sales.every((s: any) => s.created_by_user_node === ctx.userNode)).toBe(true);
    await grantPerms(ctx.userNode, ['pos.history.view', 'pos.history.viewAll']);
  });

  it('filters by status', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales?status=pending_payment'));
    const body = await res.json();
    expect(body.sales.every((s: any) => s.status === 'pending_payment')).toBe(true);
  });

  it('search by phone digits', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales?q=1'));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create `netlify/functions/pos/sales-list.ts`**

```ts
import { jsonOk, jsonError } from '../_shared/http';
import { db } from '../_shared/db';
import { requirePos } from './_authz';
import { SalesListQuery } from './_validators';

export const config = { path: '/api/pos/sales' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.history.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const q = SalesListQuery.parse(Object.fromEntries(url.searchParams));
  const sql = db();

  // Compose WHERE incrementally — Neon http doesn't support dynamic params well,
  // so use coalesce/IS NULL OR pattern in a single template literal.
  const onlyOwn = !a.ctx.perms.has('pos.history.viewAll');
  const effectiveCashier = onlyOwn ? a.ctx.userNodeId : (q.cashier ?? null);
  const statusArr  = q.status  ?? null;
  const channelArr = q.channel ?? null;
  const allDigits = q.q && /^\d+$/.test(q.q);
  const phoneQ = allDigits ? `%${q.q}%` : null;
  const nameQ  = !allDigits && q.q ? `%${q.q}%` : null;
  const orderNoQ = allDigits ? Number(q.q) : null;

  const rows = (await sql`
    SELECT s.id, s.order_no, s.status, s.channel,
           s.customer_name, s.customer_phone, s.customer_email,
           s.subtotal_cents, s.total_cents,
           s.created_at, s.paid_at, s.fulfilled_at, s.cancelled_at, s.refunded_at,
           s.created_by_user_node,
           (SELECT COUNT(*) FROM public.sale_lines WHERE sale_id = s.id) AS line_count
    FROM public.sales s
    WHERE s.bucket_id = ${a.ctx.bucketId}
      AND (${effectiveCashier}::uuid IS NULL OR s.created_by_user_node = ${effectiveCashier}::uuid)
      AND (${statusArr}::text[] IS NULL OR s.status::text = ANY(${statusArr}::text[]))
      AND (${channelArr}::text[] IS NULL OR s.channel::text = ANY(${channelArr}::text[]))
      AND s.created_at >= ${q.from}::date
      AND s.created_at <  (${q.to}::date + interval '1 day')
      AND (
        ${q.q ?? null}::text IS NULL
        OR (${phoneQ}::text IS NOT NULL AND s.customer_phone ILIKE ${phoneQ})
        OR (${nameQ}::text  IS NOT NULL AND s.customer_name  ILIKE ${nameQ})
        OR (${orderNoQ}::int IS NOT NULL AND s.order_no = ${orderNoQ}::int)
      )
    ORDER BY s.created_at DESC
    LIMIT ${q.limit}
  `) as any[];

  const summary = {
    count: rows.length,
    revenueCents: rows.filter((r) => r.status === 'paid' || r.status === 'fulfilled')
                      .reduce((a, r) => a + Number(r.total_cents), 0),
    pendingCount: rows.filter((r) => r.status === 'pending_payment').length,
    pickupQueueCount: rows.filter((r) => r.channel === 'pickup' && r.status === 'paid').length,
  };

  return jsonOk({
    sales: rows,
    nextCursor: rows.length === q.limit ? rows[rows.length - 1].created_at : null,
    summary,
  });
}
```

- [ ] **Step 4: Run + verify PASS**

- [ ] **Step 5: Commit**

```
git add netlify/functions/pos/sales-list.ts tests/pos/sales-list.spec.ts
git commit -m "feat(pos): GET /api/pos/sales — filterable list with summary + viewAll gate"
```

---

### Task 12: `GET /api/pos/sales/:id` (detail)

**Files:**
- Create: `netlify/functions/pos/sale-detail.ts`
- Create: `tests/pos/sale-detail.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos/sale-detail';
import createHandler from '../../netlify/functions/pos/sale-create';
import { seedBucketWithProductsEnabled, seedProducts, grantPerms, makeBucketUserRequest } from './_helpers';

let ctx: any, saleId: string;
beforeAll(async () => {
  ctx = await seedBucketWithProductsEnabled();
  const [pid] = await seedProducts(ctx.bucket, [{ name: 'X', sale_price_cents: 100, pos_visible: true }]);
  await grantPerms(ctx.userNode, ['pos.sale.create', 'pos.history.view', 'pos.history.viewAll']);
  const r = await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
    channel: 'instore', idempotencyKey: crypto.randomUUID(),
    customer: { name: 'A', phone: '1' }, lines: [{ productId: pid, qty: 1 }],
  }));
  saleId = (await r.json()).id;
});

describe('GET /api/pos/sales/:id', () => {
  it('returns sale + lines + audit', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET', `/api/pos/sales/${saleId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(saleId);
    expect(body.lines.length).toBeGreaterThan(0);
    expect(body.audit.length).toBeGreaterThan(0);
  });
  it('returns 404 for other user without viewAll', async () => {
    const other = await seedBucketWithProductsEnabled();
    await grantPerms(other.userNode, ['pos.history.view']);   // no viewAll
    const res = await handler(makeBucketUserRequest(other, 'GET', `/api/pos/sales/${saleId}`));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create `netlify/functions/pos/sale-detail.ts`**

```ts
import { jsonOk, jsonError } from '../_shared/http';
import { db } from '../_shared/db';
import { requirePos } from './_authz';

export const config = { path: '/api/pos/sales/:id' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.history.view']);
  if (!a.ok) return a.res;

  const id = new URL(req.url).pathname.split('/').pop()!;
  const sql = db();
  const [sale] = (await sql`
    SELECT * FROM public.sales WHERE id = ${id} AND bucket_id = ${a.ctx.bucketId}
  `) as any[];
  if (!sale) return jsonError(404, 'not_found');

  if (!a.ctx.perms.has('pos.history.viewAll') && sale.created_by_user_node !== a.ctx.userNodeId) {
    return jsonError(404, 'not_found');   // leak prevention — 404 not 403
  }

  const lines = (await sql`
    SELECT * FROM public.sale_lines WHERE sale_id = ${id} ORDER BY position
  `) as any[];
  const audit = (await sql`
    SELECT op, actor_user_node, detail, created_at
    FROM public.audit_log
    WHERE target_type = 'sale' AND target_id = ${id}
    ORDER BY created_at
  `) as any[];

  return jsonOk({ ...sale, lines, audit });
}
```

- [ ] **Step 4: Run + verify PASS**

- [ ] **Step 5: Commit**

```
git add netlify/functions/pos/sale-detail.ts tests/pos/sale-detail.spec.ts
git commit -m "feat(pos): GET /api/pos/sales/:id — detail + audit, 404 cross-user leak guard"
```

---

### Task 13: `POST /api/pos/sales/:id/state` (FSM transitions)

**Files:**
- Create: `netlify/functions/pos/sale-state.ts`
- Create: `tests/pos/sale-state.spec.ts`

- [ ] **Step 1: Failing test (covering all 4 transitions + error precedence)**

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/pos/sale-state';
import createHandler from '../../netlify/functions/pos/sale-create';
import { seedBucketWithProductsEnabled, seedProducts, grantPerms, makeBucketUserRequest } from './_helpers';

async function freshSale(ctx: any, productId: string) {
  const r = await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
    channel: 'instore', idempotencyKey: crypto.randomUUID(),
    customer: { name: 'A', phone: '1' },
    lines: [{ productId, qty: 1 }],
  }));
  return (await r.json()).id;
}

let ctx: any, productId: string;
beforeAll(async () => {
  ctx = await seedBucketWithProductsEnabled();
  [productId] = await seedProducts(ctx.bucket, [{ name: 'X', sale_price_cents: 100, pos_visible: true }]);
});

describe('POST /api/pos/sales/:id/state', () => {
  it('instore + markPaid auto-fulfills (stamps both timestamps)', async () => {
    await grantPerms(ctx.userNode, ['pos.sale.create', 'pos.sale.markPaid', 'pos.history.view']);
    const sid = await freshSale(ctx, productId);
    const res = await handler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`,
      { action: 'markPaid', paymentMethod: 'cash' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fulfilled');
    expect(body.paid_at).toBeTruthy();
    expect(body.fulfilled_at).toBeTruthy();
  });

  it('error precedence: missing perm wins over illegal state', async () => {
    await grantPerms(ctx.userNode, ['pos.sale.create', 'pos.sale.markPaid', 'pos.history.view']);
    const sid = await freshSale(ctx, productId);
    // First, mark paid (now in fulfilled state).
    await handler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`,
      { action: 'markPaid', paymentMethod: 'cash' }));
    // Drop perm + try markPaid again on already-paid sale.
    await grantPerms(ctx.userNode, ['pos.history.view']);
    const res = await handler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`,
      { action: 'markPaid', paymentMethod: 'cash' }));
    expect(res.status).toBe(403);   // NOT 409
  });

  it('cancel pending_payment with perm', async () => {
    await grantPerms(ctx.userNode, ['pos.sale.create', 'pos.sale.cancel']);
    const sid = await freshSale(ctx, productId);
    const res = await handler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`,
      { action: 'cancel', reason: 'wrong order' }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('cancelled');
  });

  it('illegal: cancel a paid sale → 409', async () => {
    await grantPerms(ctx.userNode, ['pos.sale.create', 'pos.sale.markPaid', 'pos.sale.cancel']);
    const sid = await freshSale(ctx, productId);
    await handler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`,
      { action: 'markPaid', paymentMethod: 'cash' }));
    const res = await handler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`,
      { action: 'cancel' }));
    expect(res.status).toBe(409);
  });

  it('refund a fulfilled sale', async () => {
    await grantPerms(ctx.userNode, ['pos.sale.create', 'pos.sale.markPaid', 'pos.sale.refund']);
    const sid = await freshSale(ctx, productId);
    await handler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`,
      { action: 'markPaid', paymentMethod: 'cash' }));
    const res = await handler(makeBucketUserRequest(ctx, 'POST', `/api/pos/sales/${sid}/state`,
      { action: 'refund', reason: 'spoiled' }));
    expect((await res.json()).status).toBe('refunded');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create `netlify/functions/pos/sale-state.ts`**

```ts
import { jsonOk, jsonError } from '../_shared/http';
import { db } from '../_shared/db';
import { logAudit } from '../_shared/audit';
import { requirePos } from './_authz';
import { SaleStateBody } from './_validators';
import { applyTransition, FSM_ERROR, type SaleStatus, type SaleChannel } from './_fsm';

export const config = { path: '/api/pos/sales/:id/state' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.history.view']);
  if (!a.ok) return a.res;

  const id = new URL(req.url).pathname.split('/').slice(-2, -1)[0];

  let body: SaleStateBody;
  try { body = SaleStateBody.parse(await req.json()); }
  catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }

  const sql = db();
  const [sale] = (await sql`
    SELECT id, status, channel FROM public.sales
    WHERE id = ${id} AND bucket_id = ${a.ctx.bucketId}
  `) as Array<{ id: string; status: SaleStatus; channel: SaleChannel }>;
  if (!sale) return jsonError(404, 'not_found');

  const result = applyTransition({
    from: sale.status, channel: sale.channel,
    action: body.action, perms: a.ctx.perms,
  });
  if (!result.ok) {
    if (result.code === FSM_ERROR.MISSING_PERM) return jsonError(403, 'missing_permission');
    return jsonError(409, 'illegal_transition');
  }

  // 422 — markPaid requires payment_method
  if (body.action === 'markPaid' && !body.paymentMethod) {
    return jsonError(422, 'payment_method_required');
  }

  const now = new Date();
  const updates: Record<string, unknown> = { status: result.to };
  if (body.action === 'markPaid') {
    updates.paid_at = now;
    updates.payment_method = body.paymentMethod;
    if (result.alsoPaid) updates.fulfilled_at = now;
  } else if (body.action === 'fulfill')  updates.fulfilled_at = now;
    else if (body.action === 'cancel')   updates.cancelled_at = now;
    else if (body.action === 'refund')   updates.refunded_at  = now;

  await sql`
    UPDATE public.sales SET
      status         = ${updates.status as string}::sale_status,
      paid_at        = COALESCE(${updates.paid_at ?? null}::timestamptz, paid_at),
      fulfilled_at   = COALESCE(${updates.fulfilled_at ?? null}::timestamptz, fulfilled_at),
      cancelled_at   = COALESCE(${updates.cancelled_at ?? null}::timestamptz, cancelled_at),
      refunded_at    = COALESCE(${updates.refunded_at ?? null}::timestamptz, refunded_at),
      payment_method = COALESCE(${updates.payment_method ?? null}, payment_method)
    WHERE id = ${id}
  `;

  // Audit row(s) — two rows for instore auto-fulfill.
  await logAudit(sql, {
    session: { kind: 'bucket_user', user_node_id: a.ctx.userNodeId } as any,
    op: `pos.sale.${body.action}`,
    clientId: a.ctx.bucketId, targetType: 'sale', targetId: id,
    detail: { from: sale.status, to: result.alsoPaid ? 'paid' : result.to, reason: body.reason },
  });
  if (result.alsoPaid) {
    await logAudit(sql, {
      session: { kind: 'bucket_user', user_node_id: a.ctx.userNodeId } as any,
      op: 'pos.sale.fulfill',
      clientId: a.ctx.bucketId, targetType: 'sale', targetId: id,
      detail: { from: 'paid', to: 'fulfilled', auto: true },
    });
  }

  const [updated] = (await sql`SELECT * FROM public.sales WHERE id = ${id}`) as any[];
  return jsonOk(updated);
}
```

- [ ] **Step 4: Run to verify PASS**

- [ ] **Step 5: Commit**

```
git add netlify/functions/pos/sale-state.ts tests/pos/sale-state.spec.ts
git commit -m "feat(pos): POST /api/pos/sales/:id/state — FSM transitions w/ perm precedence"
```

---

## Phase 4 — Frontend libs (Tasks 14–17)

### Task 14: `src/modules/pos/lib/money.ts`

**Files:**
- Create: `src/modules/pos/lib/money.ts`
- Create: `src/modules/pos/__tests__/money.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { formatRupees, formatOrderNo } from '../lib/money';

describe('money', () => {
  it('formats paise to rupees with comma grouping', () => {
    expect(formatRupees(0)).toBe('₹0');
    expect(formatRupees(22000)).toBe('₹220');
    expect(formatRupees(128050)).toBe('₹1,280.50');
    expect(formatRupees(2864000)).toBe('₹28,640');
  });
  it('pads order_no to 5 digits with S- prefix', () => {
    expect(formatOrderNo(1)).toBe('S-00001');
    expect(formatOrderNo(42)).toBe('S-00042');
    expect(formatOrderNo(99999)).toBe('S-99999');
    expect(formatOrderNo(100000)).toBe('S-100000');   // no truncation past 5
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implementation**

```ts
// src/modules/pos/lib/money.ts
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const fmt = new Intl.NumberFormat('en-IN').format(rupees);
  return fraction === 0 ? `${sign}₹${fmt}` : `${sign}₹${fmt}.${String(fraction).padStart(2, '0')}`;
}

export function formatOrderNo(n: number): string {
  return `S-${String(n).padStart(5, '0')}`;
}
```

- [ ] **Step 4: Run + verify PASS**

- [ ] **Step 5: Commit**

```
git add src/modules/pos/lib/money.ts src/modules/pos/__tests__/money.spec.ts
git commit -m "feat(pos): money formatters — rupees with grouping, S-00042 order no"
```

---

### Task 15: `src/modules/pos/lib/fsm.ts` (FE mirror of server FSM)

A thin re-export of the action/perm matrix for FE button gating. Mirrors `_fsm.ts` so FE can disable buttons without round-tripping.

**Files:**
- Create: `src/modules/pos/lib/fsm.ts`
- Create: `src/modules/pos/__tests__/fsm.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { allowedActions } from '../lib/fsm';

const perms = (...keys: string[]) => new Set(keys);

describe('allowedActions', () => {
  it('pending_payment + all perms → [markPaid, cancel]', () => {
    expect(allowedActions({ status: 'pending_payment', channel: 'instore',
      perms: perms('pos.sale.markPaid','pos.sale.fulfill','pos.sale.cancel','pos.sale.refund') }))
      .toEqual(['markPaid', 'cancel']);
  });
  it('paid + pickup + all perms → [fulfill, refund]', () => {
    expect(allowedActions({ status: 'paid', channel: 'pickup',
      perms: perms('pos.sale.markPaid','pos.sale.fulfill','pos.sale.cancel','pos.sale.refund') }))
      .toEqual(['fulfill', 'refund']);
  });
  it('fulfilled + no refund perm → []', () => {
    expect(allowedActions({ status: 'fulfilled', channel: 'instore', perms: perms() }))
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implementation**

```ts
// src/modules/pos/lib/fsm.ts
export type SaleStatus = 'pending_payment'|'paid'|'fulfilled'|'cancelled'|'refunded';
export type SaleChannel = 'instore'|'online'|'pickup';
export type FsmAction = 'markPaid'|'fulfill'|'cancel'|'refund';

const PERM: Record<FsmAction, string> = {
  markPaid: 'pos.sale.markPaid', fulfill: 'pos.sale.fulfill',
  cancel:   'pos.sale.cancel',   refund:  'pos.sale.refund',
};
const ALLOWED_FROM: Record<FsmAction, readonly SaleStatus[]> = {
  markPaid: ['pending_payment'], fulfill: ['paid'],
  cancel:   ['pending_payment'], refund:  ['paid','fulfilled'],
};
const ORDER: readonly FsmAction[] = ['markPaid', 'fulfill', 'cancel', 'refund'];

export function allowedActions(args: {
  status: SaleStatus; channel: SaleChannel; perms: ReadonlySet<string>;
}): FsmAction[] {
  return ORDER.filter((a) =>
    args.perms.has(PERM[a]) && ALLOWED_FROM[a].includes(args.status));
}

export function instoreAutoFulfills(action: FsmAction, channel: SaleChannel): boolean {
  return action === 'markPaid' && channel === 'instore';
}
```

- [ ] **Step 4: Run + verify PASS**

- [ ] **Step 5: Commit**

```
git add src/modules/pos/lib/fsm.ts src/modules/pos/__tests__/fsm.spec.ts
git commit -m "feat(pos): FE FSM helpers for action-button gating"
```

---

### Task 16: `src/modules/pos/store/cart.ts` (zustand store)

**Files:**
- Create: `src/modules/pos/store/cart.ts`
- Create: `src/modules/pos/__tests__/cart-store.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createCartStore } from '../store/cart';

const sampleProduct = (id = 'p1', price = 22000) => ({
  id, name: 'Cap', categoryId: null, salePriceCents: price, thumbUrl: null,
});

describe('cart store', () => {
  let store: ReturnType<typeof createCartStore>;
  beforeEach(() => { store = createCartStore('bucket1', 'user1'); });

  it('addLine: dedups by productId, snapshots price', () => {
    const s = store.getState();
    s.addLine(sampleProduct('p1', 100));
    s.addLine(sampleProduct('p1', 999));   // price changed mid-flight
    const lines = store.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
    expect(lines[0].unitPriceCentsSnap).toBe(100);   // first snapshot wins
  });

  it('setQty(0) removes the line', () => {
    store.getState().addLine(sampleProduct('p1'));
    store.getState().setQty('p1', 0);
    expect(store.getState().lines).toHaveLength(0);
  });

  it('subtotalCents = sum(qty * snap)', () => {
    store.getState().addLine(sampleProduct('p1', 100));
    store.getState().setQty('p1', 3);
    store.getState().addLine(sampleProduct('p2', 50));
    expect(store.getState().subtotalCents()).toBe(3*100 + 50);
  });

  it('isValidForSubmit requires lines + name + phone', () => {
    const s = store.getState();
    expect(s.isValidForSubmit().ok).toBe(false);
    s.addLine(sampleProduct());
    expect(s.isValidForSubmit().ok).toBe(false);
    s.setCustomer({ name: 'R' });
    expect(s.isValidForSubmit().ok).toBe(false);
    s.setCustomer({ phone: '1' });
    expect(s.isValidForSubmit().ok).toBe(true);
  });

  it('idempotencyKey persists across addLines, regenerates after clear()', () => {
    const s = store.getState();
    s.addLine(sampleProduct('p1'));
    const k1 = store.getState().idempotencyKey;
    s.addLine(sampleProduct('p2'));
    expect(store.getState().idempotencyKey).toBe(k1);
    s.clear();
    s.addLine(sampleProduct('p1'));
    expect(store.getState().idempotencyKey).not.toBe(k1);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implementation**

```ts
// src/modules/pos/store/cart.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface MenuProduct {
  id: string; name: string; categoryId: string|null;
  salePriceCents: number; thumbUrl: string|null;
}

export interface CartLine {
  productId: string; productNameSnap: string;
  unitPriceCentsSnap: number; qty: number;
}

export interface CartState {
  lines: CartLine[];
  customer: { name: string; phone: string; email: string };
  channel: 'instore' | 'online' | 'pickup';
  idempotencyKey: string;

  addLine(p: MenuProduct): void;
  setQty(productId: string, qty: number): void;
  removeLine(productId: string): void;
  setCustomer(patch: Partial<CartState['customer']>): void;
  setChannel(c: CartState['channel']): void;
  clear(): void;

  subtotalCents(): number;
  itemCount(): number;
  isValidForSubmit(): { ok: boolean; reason?: string };
}

const newKey = () => crypto.randomUUID();
const emptyCustomer = () => ({ name: '', phone: '', email: '' });

export function createCartStore(bucketId: string, userNodeId: string) {
  const storageKey = `pos-cart:${bucketId}:${userNodeId}`;
  return create<CartState>()(
    persist(
      (set, get) => ({
        lines: [],
        customer: emptyCustomer(),
        channel: 'instore',
        idempotencyKey: newKey(),

        addLine(p) {
          set((s) => {
            const existing = s.lines.find((l) => l.productId === p.id);
            if (existing) {
              return { lines: s.lines.map((l) =>
                l.productId === p.id ? { ...l, qty: l.qty + 1 } : l) };
            }
            return { lines: [...s.lines, {
              productId: p.id, productNameSnap: p.name,
              unitPriceCentsSnap: p.salePriceCents, qty: 1,
            }] };
          });
        },
        setQty(productId, qty) {
          if (qty <= 0) return get().removeLine(productId);
          set((s) => ({ lines: s.lines.map((l) =>
            l.productId === productId ? { ...l, qty } : l) }));
        },
        removeLine(productId) {
          set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) }));
        },
        setCustomer(patch) { set((s) => ({ customer: { ...s.customer, ...patch } })); },
        setChannel(c) { set({ channel: c }); },
        clear() {
          set({ lines: [], customer: emptyCustomer(), channel: 'instore',
                idempotencyKey: newKey() });
        },

        subtotalCents() {
          return get().lines.reduce((a, l) => a + l.qty * l.unitPriceCentsSnap, 0);
        },
        itemCount() { return get().lines.reduce((a, l) => a + l.qty, 0); },
        isValidForSubmit() {
          const s = get();
          if (s.lines.length === 0) return { ok: false, reason: 'empty_cart' };
          if (!s.customer.name.trim()) return { ok: false, reason: 'name_required' };
          if (!s.customer.phone.trim()) return { ok: false, reason: 'phone_required' };
          if (s.customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.customer.email)) {
            return { ok: false, reason: 'email_invalid' };
          }
          return { ok: true };
        },
      }),
      { name: storageKey, storage: createJSONStorage(() => localStorage) },
    ),
  );
}
```

- [ ] **Step 4: Run + verify PASS**

- [ ] **Step 5: Commit**

```
git add src/modules/pos/store/cart.ts src/modules/pos/__tests__/cart-store.spec.ts
git commit -m "feat(pos): zustand cart store with snapshot prices + idempotency key"
```

---

### Task 17: `src/modules/pos/api.ts` (typed fetch wrappers)

**Files:**
- Create: `src/modules/pos/api.ts`
- Create: `src/modules/pos/__tests__/api.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { posApi } from '../api';

describe('posApi', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('getMenu calls GET /api/pos/menu', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ products: [], categories: [] }), { status: 200 })
    );
    await posApi.getMenu();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/pos/menu');
  });

  it('createSale POSTs the body and parses 201', async () => {
    const body = { channel: 'instore', idempotencyKey: 'k', customer: { name: 'A', phone: '1' }, lines: [] };
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 's1' }), { status: 201 }));
    const res = await posApi.createSale(body as any);
    expect(res.id).toBe('s1');
  });

  it('createSale throws PosApiError on 4xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'invalid_body' } }), { status: 400 })
    );
    await expect(posApi.createSale({} as any)).rejects.toMatchObject({ status: 400, code: 'invalid_body' });
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implementation**

```ts
// src/modules/pos/api.ts
export class PosApiError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) {
    super(code);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new PosApiError(res.status, body?.error?.code ?? 'unknown', body?.error?.details);
  }
  return res.json();
}

export interface MenuResponse {
  categories: { id: string; name: string; productCount: number }[];
  products:   { id: string; name: string; categoryId: string|null;
                salePriceCents: number; thumbUrl: string|null }[];
}

export const posApi = {
  getMenu: () => call<MenuResponse>('/api/pos/menu'),
  createSale: (body: unknown) => call<any>('/api/pos/sales', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  getSales: (query: string) => call<any>(`/api/pos/sales${query ? '?' + query : ''}`),
  getSale: (id: string) => call<any>(`/api/pos/sales/${id}`),
  transition: (id: string, body: unknown) => call<any>(`/api/pos/sales/${id}/state`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
};
```

- [ ] **Step 4: Run + verify PASS**

- [ ] **Step 5: Commit**

```
git add src/modules/pos/api.ts src/modules/pos/__tests__/api.spec.ts
git commit -m "feat(pos): typed fetch wrappers with PosApiError"
```

---

## Phase 5 — Frontend pages & components (Tasks 18–21)

Component subtask philosophy: keep components small (one file = one responsibility), bring them together in page-level tests. Pages get integration-style tests using happy-dom + msw or fetch mocks.

### Task 18: Menu page — components + page integration

**Files:**
- Create: `src/modules/pos/components/{ProductTile,MenuSearchBar,CategoryTabs,SideCartPanel}.tsx`
- Create: `src/modules/pos/pages/MenuPage.tsx`
- Create: `src/modules/pos/__tests__/MenuPage.spec.tsx`

- [ ] **Step 1: Failing test (page-level integration)**

```tsx
// src/modules/pos/__tests__/MenuPage.spec.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MenuPage from '../pages/MenuPage';

const fixture = {
  categories: [{ id: 'c1', name: 'Beverages', productCount: 1 }],
  products: [
    { id: 'p1', name: 'Cappuccino', categoryId: 'c1', salePriceCents: 22000, thumbUrl: null },
    { id: 'p2', name: 'Pasta',      categoryId: null, salePriceCents: 52000, thumbUrl: null },
  ],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
  localStorage.clear();
});

describe('MenuPage', () => {
  it('renders tiles after fetch', async () => {
    render(<MemoryRouter><MenuPage bucketId="b1" userNodeId="u1" /></MemoryRouter>);
    expect(await screen.findByText('Cappuccino')).toBeInTheDocument();
    expect(screen.getByText('Pasta')).toBeInTheDocument();
  });

  it('search filters tiles in-memory', async () => {
    render(<MemoryRouter><MenuPage bucketId="b1" userNodeId="u1" /></MemoryRouter>);
    await screen.findByText('Cappuccino');
    fireEvent.change(screen.getByPlaceholderText(/filter menu/i), { target: { value: 'pas' } });
    expect(screen.queryByText('Cappuccino')).not.toBeInTheDocument();
    expect(screen.getByText('Pasta')).toBeInTheDocument();
  });

  it('clicking a tile adds to cart and shows total in side panel', async () => {
    render(<MemoryRouter><MenuPage bucketId="b1" userNodeId="u1" /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Cappuccino'));
    await waitFor(() => expect(screen.getByTestId('side-cart-total')).toHaveTextContent('₹220'));
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create the leaf components**

```tsx
// src/modules/pos/components/ProductTile.tsx
import type { MenuProduct } from '../store/cart';
import { formatRupees } from '../lib/money';

export function ProductTile(props: { product: MenuProduct; inCartQty: number; onAdd: () => void }) {
  return (
    <button onClick={props.onAdd} className="pos-tile" aria-label={`Add ${props.product.name}`}>
      <div className="pos-tile__img">
        {props.product.thumbUrl ? <img src={props.product.thumbUrl} alt="" /> : null}
      </div>
      <div className="pos-tile__name">{props.product.name}</div>
      <div className="pos-tile__price">{formatRupees(props.product.salePriceCents)}</div>
      {props.inCartQty > 0 ? <span className="pos-tile__badge">{props.inCartQty}</span> : null}
    </button>
  );
}
```

```tsx
// src/modules/pos/components/MenuSearchBar.tsx
export function MenuSearchBar(props: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="search"
      placeholder="Filter menu…"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="pos-search"
    />
  );
}
```

```tsx
// src/modules/pos/components/CategoryTabs.tsx
export function CategoryTabs(props: {
  categories: { id: string; name: string; productCount: number }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <div role="tablist" className="pos-tabs">
      <button onClick={() => props.onChange(null)}
              aria-selected={props.value === null}>All</button>
      {props.categories.map((c) => (
        <button key={c.id} aria-selected={props.value === c.id}
                onClick={() => props.onChange(c.id)}>
          {c.name} ({c.productCount})
        </button>
      ))}
    </div>
  );
}
```

```tsx
// src/modules/pos/components/SideCartPanel.tsx
import { Link } from 'react-router-dom';
import { formatRupees } from '../lib/money';
import type { CartLine } from '../store/cart';

export function SideCartPanel(props: { lines: CartLine[]; subtotal: number }) {
  if (props.lines.length === 0) {
    return <aside className="pos-side-cart pos-side-cart--empty">
      Tap items to start an order
    </aside>;
  }
  return (
    <aside className="pos-side-cart">
      <h3>Cart ({props.lines.length})</h3>
      <ul>
        {props.lines.map((l) => (
          <li key={l.productId}>
            {l.productNameSnap} ×{l.qty} — {formatRupees(l.unitPriceCentsSnap * l.qty)}
          </li>
        ))}
      </ul>
      <div className="pos-side-cart__total" data-testid="side-cart-total">
        Total {formatRupees(props.subtotal)}
      </div>
      <Link to="/pos/cart" className="pos-side-cart__checkout">Checkout →</Link>
    </aside>
  );
}
```

- [ ] **Step 4: Create `src/modules/pos/pages/MenuPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { posApi, type MenuResponse } from '../api';
import { createCartStore } from '../store/cart';
import { MenuSearchBar } from '../components/MenuSearchBar';
import { CategoryTabs } from '../components/CategoryTabs';
import { ProductTile } from '../components/ProductTile';
import { SideCartPanel } from '../components/SideCartPanel';

export default function MenuPage(props: { bucketId: string; userNodeId: string }) {
  const useStore = useMemo(() => createCartStore(props.bucketId, props.userNodeId),
                           [props.bucketId, props.userNodeId]);
  const lines = useStore((s) => s.lines);
  const subtotal = useStore((s) => s.subtotalCents());
  const addLine = useStore((s) => s.addLine);

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  useEffect(() => { posApi.getMenu().then(setMenu).catch(() => setMenu({categories:[],products:[]})); }, []);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const q = query.trim().toLowerCase();
    return menu.products.filter((p) => {
      if (cat && p.categoryId !== cat) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [menu, query, cat]);

  const qtyById = useMemo(
    () => Object.fromEntries(lines.map((l) => [l.productId, l.qty])),
    [lines],
  );

  if (!menu) return <div className="pos-loading">Loading menu…</div>;

  return (
    <div className="pos-menu">
      <header>
        <MenuSearchBar value={query} onChange={setQuery} />
        <CategoryTabs categories={menu.categories} value={cat} onChange={setCat} />
      </header>
      <main className="pos-menu__grid">
        {filtered.map((p) => (
          <ProductTile key={p.id} product={p} inCartQty={qtyById[p.id] ?? 0}
                       onAdd={() => addLine(p)} />
        ))}
      </main>
      <SideCartPanel lines={lines} subtotal={subtotal} />
    </div>
  );
}
```

- [ ] **Step 5: Run + verify PASS + typecheck**

- [ ] **Step 6: Commit**

```
git add src/modules/pos/components src/modules/pos/pages/MenuPage.tsx src/modules/pos/__tests__/MenuPage.spec.tsx
git commit -m "feat(pos): MenuPage with photo-tile grid + search + side cart"
```

---

### Task 19: Cart page — components + page integration

**Files:**
- Create: `src/modules/pos/components/{CartLineRow,CustomerForm,ChannelPicker}.tsx`
- Create: `src/modules/pos/pages/CartPage.tsx`
- Create: `src/modules/pos/__tests__/CartPage.spec.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CartPage from '../pages/CartPage';
import { createCartStore } from '../store/cart';

const sampleProduct = (id = 'p1', price = 22000, name = 'X') =>
  ({ id, name, categoryId: null, salePriceCents: price, thumbUrl: null });

function setup(initial: (s: any) => void) {
  localStorage.clear();
  const useStore = createCartStore('b1', 'u1');
  initial(useStore.getState());
  return render(
    <MemoryRouter initialEntries={['/pos/cart']}>
      <Routes><Route path="/pos/cart" element={<CartPage bucketId="b1" userNodeId="u1" />} /></Routes>
    </MemoryRouter>
  );
}

describe('CartPage', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('submit disabled when phone empty', () => {
    setup((s) => { s.addLine(sampleProduct()); s.setCustomer({ name: 'R' }); });
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });

  it('submit enabled when name + phone present + line present', () => {
    setup((s) => { s.addLine(sampleProduct()); s.setCustomer({ name: 'R', phone: '9' }); });
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled();
  });

  it('does NOT render discount/tax rows when zero', () => {
    setup((s) => s.addLine(sampleProduct()));
    expect(screen.queryByText(/discount/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tax/i)).not.toBeInTheDocument();
  });

  it('clicking submit POSTs and clears cart', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 's1' }), { status: 201 }));
    setup((s) => { s.addLine(sampleProduct()); s.setCustomer({ name: 'R', phone: '9' }); });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await new Promise((r) => setTimeout(r, 0));
    // store should be cleared after success
    const useStore = createCartStore('b1', 'u1');
    expect(useStore.getState().lines).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create leaf components**

```tsx
// src/modules/pos/components/CartLineRow.tsx
import type { CartLine } from '../store/cart';
import { formatRupees } from '../lib/money';

export function CartLineRow(props: {
  line: CartLine;
  onQty: (qty: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="pos-cart-line">
      <div className="pos-cart-line__name">{props.line.productNameSnap}</div>
      <div className="pos-cart-line__qty">
        <button onClick={() => props.onQty(props.line.qty - 1)} aria-label="Decrease">−</button>
        <span>{props.line.qty}</span>
        <button onClick={() => props.onQty(props.line.qty + 1)} aria-label="Increase">+</button>
      </div>
      <div>{formatRupees(props.line.unitPriceCentsSnap * props.line.qty)}</div>
      <button onClick={props.onRemove} aria-label="Remove">×</button>
    </div>
  );
}
```

```tsx
// src/modules/pos/components/CustomerForm.tsx
import { useState } from 'react';

interface Props {
  value: { name: string; phone: string; email: string };
  onChange: (patch: Partial<Props['value']>) => void;
}

export function CustomerForm({ value, onChange }: Props) {
  const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string }>({});
  const blurValidate = (k: 'name' | 'phone' | 'email') => () => {
    if (k === 'name'  && !value.name.trim())  return setErrors((e) => ({ ...e, name:  'Required' }));
    if (k === 'phone' && !value.phone.trim()) return setErrors((e) => ({ ...e, phone: 'Required' }));
    if (k === 'email' && value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
      return setErrors((e) => ({ ...e, email: 'Invalid email' }));
    }
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  return (
    <div className="pos-customer-form">
      <label>Name *
        <input value={value.name}  onChange={(e) => onChange({ name:  e.target.value })} onBlur={blurValidate('name')}  />
        {errors.name  ? <span className="err">{errors.name}</span>  : null}
      </label>
      <label>Phone *
        <input value={value.phone} onChange={(e) => onChange({ phone: e.target.value })} onBlur={blurValidate('phone')} />
        {errors.phone ? <span className="err">{errors.phone}</span> : null}
      </label>
      <label>Email
        <input value={value.email} onChange={(e) => onChange({ email: e.target.value })} onBlur={blurValidate('email')} />
        {errors.email ? <span className="err">{errors.email}</span> : null}
      </label>
    </div>
  );
}
```

```tsx
// src/modules/pos/components/ChannelPicker.tsx
const opts = [
  { v: 'instore', label: '🏪 Instore' },
  { v: 'online',  label: '🌐 Online' },
  { v: 'pickup',  label: '📦 Pickup' },
] as const;

export function ChannelPicker(props: {
  value: 'instore' | 'online' | 'pickup';
  onChange: (v: 'instore' | 'online' | 'pickup') => void;
}) {
  return (
    <div role="radiogroup" className="pos-channel">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={props.value === o.v}
                onClick={() => props.onChange(o.v)}
                className={props.value === o.v ? 'is-active' : ''}>{o.label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `src/modules/pos/pages/CartPage.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createCartStore } from '../store/cart';
import { CartLineRow } from '../components/CartLineRow';
import { CustomerForm } from '../components/CustomerForm';
import { ChannelPicker } from '../components/ChannelPicker';
import { posApi, PosApiError } from '../api';
import { formatRupees } from '../lib/money';

export default function CartPage(props: { bucketId: string; userNodeId: string }) {
  const useStore = useMemo(() => createCartStore(props.bucketId, props.userNodeId),
                           [props.bucketId, props.userNodeId]);
  const state = useStore();
  const nav = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = state.subtotalCents();
  const validity = state.isValidForSubmit();

  async function submit() {
    setSubmitting(true); setError(null);
    try {
      const sale = await posApi.createSale({
        channel: state.channel,
        idempotencyKey: state.idempotencyKey,
        customer: { ...state.customer, email: state.customer.email || undefined },
        lines: state.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      });
      state.clear();
      nav(`/pos/sales/${sale.id}`);
    } catch (e) {
      if (e instanceof PosApiError) setError(e.code);
      else setError('network_error');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="pos-cart-page">
      <header><Link to="/pos/menu">← Back to menu</Link><h1>Checkout</h1></header>
      <div className="pos-cart-page__cols">
        <section className="pos-cart-page__lines">
          {state.lines.length === 0 ? <p>Cart is empty.</p> : null}
          {state.lines.map((l) => (
            <CartLineRow key={l.productId} line={l}
              onQty={(q) => state.setQty(l.productId, q)}
              onRemove={() => state.removeLine(l.productId)} />
          ))}
          <div className="pos-cart-page__totals">
            <div>Subtotal {formatRupees(subtotal)}</div>
            <div className="pos-cart-page__total">Total <strong>{formatRupees(subtotal)}</strong></div>
          </div>
        </section>
        <section className="pos-cart-page__customer">
          <h2>Customer</h2>
          <CustomerForm value={state.customer} onChange={(p) => state.setCustomer(p)} />
          <h2>Channel</h2>
          <ChannelPicker value={state.channel} onChange={(c) => state.setChannel(c)} />
          {error ? <div className="err">Error: {error}</div> : null}
          <button onClick={submit} disabled={!validity.ok || submitting}>
            {submitting ? 'Submitting…' : 'Submit & take payment'}
          </button>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run + verify PASS + typecheck**

- [ ] **Step 6: Commit**

```
git add src/modules/pos/components src/modules/pos/pages/CartPage.tsx src/modules/pos/__tests__/CartPage.spec.tsx
git commit -m "feat(pos): CartPage with line rows, customer form, channel picker, submit"
```

---

### Task 20: Sales list + detail drawer

**Files:**
- Create: `src/modules/pos/components/{StatusPill,SaleStateButtons}.tsx`
- Create: `src/modules/pos/pages/{SalesListPage,SaleDetailDrawer}.tsx`
- Create: `src/modules/pos/__tests__/SalesListPage.spec.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SalesListPage from '../pages/SalesListPage';

const fixture = {
  sales: [
    { id: 's1', order_no: 42, status: 'fulfilled', channel: 'instore',
      customer_name: 'Riya', customer_phone: '9', total_cents: 128050,
      created_at: '2026-06-12T14:32:00Z', line_count: 3,
      created_by_user_node: 'u1' },
    { id: 's2', order_no: 41, status: 'pending_payment', channel: 'online',
      customer_name: 'Arjun', customer_phone: '8', total_cents: 74000,
      created_at: '2026-06-12T14:18:00Z', line_count: 2,
      created_by_user_node: 'u1' },
  ],
  nextCursor: null,
  summary: { count: 2, revenueCents: 128050, pendingCount: 1, pickupQueueCount: 0 },
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
});

describe('SalesListPage', () => {
  it('renders the table with order numbers formatted', async () => {
    render(<MemoryRouter><SalesListPage perms={new Set(['pos.history.view'])} /></MemoryRouter>);
    expect(await screen.findByText('S-00042')).toBeInTheDocument();
    expect(screen.getByText('S-00041')).toBeInTheDocument();
  });
  it('clicking a row opens the drawer (updates URL)', async () => {
    render(<MemoryRouter><SalesListPage perms={new Set(['pos.history.view'])} /></MemoryRouter>);
    fireEvent.click(await screen.findByText('S-00042'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Create `StatusPill` and `SaleStateButtons`**

```tsx
// src/modules/pos/components/StatusPill.tsx
import type { SaleStatus } from '../lib/fsm';

const COLORS: Record<SaleStatus, string> = {
  pending_payment: 'pill-amber',
  paid:            'pill-amber',
  fulfilled:       'pill-green',
  cancelled:       'pill-gray',
  refunded:        'pill-red',
};
const LABELS: Record<SaleStatus, string> = {
  pending_payment: 'Pending pay',
  paid:            'Paid',
  fulfilled:       'Fulfilled',
  cancelled:       'Cancelled',
  refunded:        'Refunded',
};

export function StatusPill({ status }: { status: SaleStatus }) {
  return <span className={`pos-pill ${COLORS[status]}`}>{LABELS[status]}</span>;
}
```

```tsx
// src/modules/pos/components/SaleStateButtons.tsx
import { allowedActions, type SaleStatus, type SaleChannel, type FsmAction } from '../lib/fsm';

const LABELS: Record<FsmAction, string> = {
  markPaid: 'Mark paid (cash)',
  fulfill:  'Mark fulfilled',
  cancel:   'Cancel',
  refund:   'Refund',
};

export function SaleStateButtons(props: {
  status: SaleStatus;
  channel: SaleChannel;
  perms: ReadonlySet<string>;
  onAction: (a: FsmAction) => void;
}) {
  const actions = allowedActions(props);
  if (actions.length === 0) return null;
  return (
    <div className="pos-state-buttons">
      {actions.map((a) => (
        <button key={a} onClick={() => props.onAction(a)}>
          {a === 'markPaid' && props.channel === 'instore'
            ? 'Mark paid (cash) & complete'
            : LABELS[a]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `SaleDetailDrawer`**

```tsx
// src/modules/pos/pages/SaleDetailDrawer.tsx
import { useEffect, useState } from 'react';
import { posApi, PosApiError } from '../api';
import { formatRupees, formatOrderNo } from '../lib/money';
import { StatusPill } from '../components/StatusPill';
import { SaleStateButtons } from '../components/SaleStateButtons';
import type { FsmAction } from '../lib/fsm';

export function SaleDetailDrawer(props: {
  saleId: string;
  perms: ReadonlySet<string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sale, setSale] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    posApi.getSale(props.saleId).then(setSale).catch((e) => setErr(e?.code ?? 'error'));
  }, [props.saleId]);

  async function doAction(a: FsmAction) {
    try {
      await posApi.transition(props.saleId, { action: a,
        ...(a === 'markPaid' ? { paymentMethod: 'cash' } : {}) });
      const refreshed = await posApi.getSale(props.saleId);
      setSale(refreshed);
      props.onChanged();
    } catch (e) {
      if (e instanceof PosApiError) setErr(e.code);
    }
  }

  if (err)  return <aside role="dialog"><button onClick={props.onClose}>×</button><p>Error: {err}</p></aside>;
  if (!sale) return <aside role="dialog">Loading…</aside>;

  return (
    <aside role="dialog" className="pos-drawer">
      <header>
        <button onClick={props.onClose}>×</button>
        <h2>{formatOrderNo(sale.order_no)} <StatusPill status={sale.status} /></h2>
        <p>Channel: {sale.channel} · Created {new Date(sale.created_at).toLocaleString()}</p>
      </header>
      <section>
        <h3>Customer</h3>
        <p>{sale.customer_name} · {sale.customer_phone}
           {sale.customer_email ? <> · <a href={`mailto:${sale.customer_email}`}>{sale.customer_email}</a></> : null}</p>
      </section>
      <section>
        <h3>Lines</h3>
        <ul>
          {sale.lines.map((l: any) => (
            <li key={l.id}>{l.product_name_snap} ×{l.qty} — {formatRupees(l.line_total_cents)}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Money</h3>
        <div>Subtotal {formatRupees(sale.subtotal_cents)}</div>
        <div>Total {formatRupees(sale.total_cents)}</div>
      </section>
      <section>
        <h3>Audit</h3>
        <ul>{sale.audit.map((a: any, i: number) => (
          <li key={i}>{a.op} — {new Date(a.created_at).toLocaleString()}</li>
        ))}</ul>
      </section>
      <SaleStateButtons status={sale.status} channel={sale.channel}
                        perms={props.perms} onAction={doAction} />
    </aside>
  );
}
```

- [ ] **Step 5: Create `SalesListPage`**

```tsx
// src/modules/pos/pages/SalesListPage.tsx
import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { posApi } from '../api';
import { formatRupees, formatOrderNo } from '../lib/money';
import { StatusPill } from '../components/StatusPill';
import { SaleDetailDrawer } from './SaleDetailDrawer';

export default function SalesListPage(props: { perms: ReadonlySet<string> }) {
  const [params, setParams] = useSearchParams();
  const { id: routeId } = useParams<{ id?: string }>();
  const openId = routeId ?? params.get('sale');
  const nav = useNavigate();

  const [data, setData] = useState<any>(null);
  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of ['status', 'channel', 'cashier', 'from', 'to', 'q']) {
      const v = params.get(k); if (v) p.set(k, v);
    }
    return p.toString();
  }, [params]);

  function reload() { posApi.getSales(queryString).then(setData); }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [queryString]);

  if (!data) return <div>Loading…</div>;

  return (
    <div className="pos-sales-list">
      <header>
        <h1>Sale History</h1>
        <Link to="/pos/menu">+ New Sale</Link>
      </header>
      <div className="pos-summary">
        <div>Sales: {data.summary.count}</div>
        <div>Revenue: {formatRupees(data.summary.revenueCents)}</div>
        <div>Pending: {data.summary.pendingCount}</div>
        <div>Pickup queue: {data.summary.pickupQueueCount}</div>
      </div>
      <table>
        <thead><tr>
          <th>Order #</th><th>Time</th><th>Customer</th><th>Items</th>
          <th>Channel</th><th>Status</th><th>Total</th>
        </tr></thead>
        <tbody>
          {data.sales.map((s: any) => (
            <tr key={s.id} onClick={() => nav(`/pos/sales/${s.id}`)}>
              <td>{formatOrderNo(s.order_no)}</td>
              <td>{new Date(s.created_at).toLocaleTimeString()}</td>
              <td>{s.customer_name} · {s.customer_phone}</td>
              <td>{s.line_count}</td>
              <td>{s.channel}</td>
              <td><StatusPill status={s.status} /></td>
              <td>{formatRupees(s.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {openId ? (
        <SaleDetailDrawer
          saleId={openId}
          perms={props.perms}
          onClose={() => nav('/pos/sales')}
          onChanged={reload} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Run + verify PASS + typecheck**

- [ ] **Step 7: Commit**

```
git add src/modules/pos/components src/modules/pos/pages/SalesListPage.tsx src/modules/pos/pages/SaleDetailDrawer.tsx src/modules/pos/__tests__/SalesListPage.spec.tsx
git commit -m "feat(pos): SalesListPage + SaleDetailDrawer with FSM-gated state buttons"
```

---

### Task 21: PosRoutes + sidebar nav wiring

**Files:**
- Create: `src/modules/pos/PosRoutes.tsx`
- Modify: `src/modules/user-portal/UserPortalRoutes.tsx` — mount `/pos/*` route
- Modify: existing sidebar nav component — add POS entry (find via `grep -r "posManifest\|Products\|Files" src/modules/user-portal/nav`)

- [ ] **Step 1: Create `PosRoutes.tsx`**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import MenuPage from './pages/MenuPage';
import CartPage from './pages/CartPage';
import SalesListPage from './pages/SalesListPage';
import { useUserAuth } from '../user-portal/user-auth-context';

export default function PosRoutes() {
  const auth = useUserAuth();          // returns { bucketId, userNodeId, perms: Set<string> }
  if (!auth?.bucketId) return <Navigate to="/login" />;

  const canMenu    = auth.perms.has('pos.menu.view');
  const canHistory = auth.perms.has('pos.history.view');

  return (
    <Routes>
      <Route index element={<Navigate to={canMenu ? 'menu' : (canHistory ? 'sales' : '/')} replace />} />
      {canMenu ? (
        <>
          <Route path="menu" element={<MenuPage bucketId={auth.bucketId} userNodeId={auth.userNodeId} />} />
          <Route path="cart" element={<CartPage bucketId={auth.bucketId} userNodeId={auth.userNodeId} />} />
        </>
      ) : null}
      {canHistory ? (
        <>
          <Route path="sales"     element={<SalesListPage perms={auth.perms} />} />
          <Route path="sales/:id" element={<SalesListPage perms={auth.perms} />} />
        </>
      ) : null}
    </Routes>
  );
}
```

**Note for implementer:** `useUserAuth` shape may not match. Read `src/modules/user-portal/user-auth-context.tsx` and align the field names; the underlying data (current bucket id, user_node id, permission set) exists — just may be named differently (e.g., `clientId` vs `bucketId`).

- [ ] **Step 2: Mount in `UserPortalRoutes.tsx`**

```tsx
// Inside the existing <Routes>:
<Route path="pos/*" element={<PosRoutes />} />
```

(Imports: `import PosRoutes from '../pos/PosRoutes';`)

- [ ] **Step 3: Add sidebar nav entry**

Find the existing nav config (likely `src/modules/user-portal/nav/...`). Add:
```tsx
// matches existing pattern; key = 'pos', icon = whatever the rest of the nav uses
{ key: 'pos', label: 'POS', to: '/pos/menu', visible: perms.has('pos.menu.view') || perms.has('pos.history.view') }
```

- [ ] **Step 4: Smoke test — launch dev**

```
npm run dev
```
Expected: sidebar shows "POS" when logged in as a bucket user with `pos.menu.view`. Click → lands on menu.

- [ ] **Step 5: Run all FE + BE tests + typecheck**

```
npm run typecheck && npm run test -- pos && npm run lint
```

- [ ] **Step 6: Commit**

```
git add src/modules/pos/PosRoutes.tsx src/modules/user-portal
git commit -m "feat(pos): mount /pos/* routes + sidebar nav entry (perm-gated)"
```

---

## Phase 6 — End-to-end smoke (Task 22)

### Task 22: Manual smoke + round-trip integration test

**Files:**
- Create: `tests/pos/round-trip.spec.ts`

- [ ] **Step 1: Write the round-trip integration test**

```ts
// tests/pos/round-trip.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import menuHandler   from '../../netlify/functions/pos/menu';
import createHandler from '../../netlify/functions/pos/sale-create';
import detailHandler from '../../netlify/functions/pos/sale-detail';
import stateHandler  from '../../netlify/functions/pos/sale-state';
import { seedBucketWithProductsEnabled, seedProducts, grantPerms,
         makeBucketUserRequest } from './_helpers';

describe('POS round-trip', () => {
  it('menu → create → mark paid (instore auto-fulfills) → detail mirrors transitions', async () => {
    const ctx = await seedBucketWithProductsEnabled();
    await seedProducts(ctx.bucket, [
      { name: 'Cap',   sale_price_cents: 22000, pos_visible: true },
      { name: 'Pasta', sale_price_cents: 52000, pos_visible: true },
    ]);
    await grantPerms(ctx.userNode,
      ['pos.menu.view','pos.sale.create','pos.sale.markPaid','pos.history.view','pos.history.viewAll']);

    const menu = await (await menuHandler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'))).json();
    expect(menu.products).toHaveLength(2);

    const sale = await (await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'instore', idempotencyKey: crypto.randomUUID(),
      customer: { name: 'R', phone: '9' },
      lines: menu.products.map((p: any) => ({ productId: p.id, qty: 1 })),
    }))).json();
    expect(sale.total_cents).toBe(22000 + 52000);

    const paid = await (await stateHandler(makeBucketUserRequest(ctx, 'POST',
      `/api/pos/sales/${sale.id}/state`, { action: 'markPaid', paymentMethod: 'cash' }))).json();
    expect(paid.status).toBe('fulfilled');  // instore auto

    const detail = await (await detailHandler(makeBucketUserRequest(ctx, 'GET',
      `/api/pos/sales/${sale.id}`))).json();
    expect(detail.lines).toHaveLength(2);
    expect(detail.audit.length).toBeGreaterThanOrEqual(2);  // created + markPaid (+ auto-fulfilled)
    expect(detail.audit.map((a: any) => a.op)).toContain('pos.sale.created');
    expect(detail.audit.map((a: any) => a.op)).toContain('pos.sale.markPaid');
  });
});
```

- [ ] **Step 2: Run to verify PASS**

```
npx vitest run tests/pos/round-trip.spec.ts
```

- [ ] **Step 3: Full verification gate**

```
npm run typecheck && npm run test -- pos && npm run lint
```

- [ ] **Step 4: Frontend manual smoke (per `[Implementer must run typecheck]` + run-the-app convention)**

In one terminal: `npm run dev -- --port 5174 --target-port 8889` (per `[Multi-worktree dev needs --target-port]` for the second worktree).
In a browser:
1. Log in as a bucket user with all 8 POS perms granted in the AMS UI.
2. Sidebar shows "POS" entry.
3. `/pos/menu`: products load, search filters, tile-click adds to cart, side cart updates total.
4. `/pos/cart`: form validates name/phone on blur, submit disabled until valid, channel default = instore.
5. Submit → land on `/pos/sales/:id` drawer.
6. In drawer: "Mark paid (cash) & complete" button → status → `Fulfilled` pill.
7. `/pos/sales`: row visible, S-NNNNN order number, status pill, click row → drawer re-opens.

Record any issues; if all green, the work is shippable to the sibling chat for main merge.

- [ ] **Step 5: Commit**

```
git add tests/pos/round-trip.spec.ts
git commit -m "test(pos): round-trip menu → create → markPaid → detail (instore auto-fulfill)"
```

---

## Self-Review Summary

**Spec coverage:**
- §3 Module/registry surface → Tasks 1, 2 ✓
- §4 Data model (migrations 040–042) → Tasks 3, 4, 5 ✓ (039 explicitly out-of-scope, PM chat)
- §5 FSM → Task 8 (server) + Task 15 (FE mirror) ✓
- §6 Endpoints (menu, sale-create, sales-list, sale-detail, sale-state) → Tasks 9–13 ✓
- §7 Frontend (routes, cart store, pages, components) → Tasks 14–21 ✓
- §8 Tests → integrated into each task + round-trip Task 22 ✓
- §9 Deployment plan → out of scope for this plan (sibling chat owns)
- §10 Worktree → already bootstrapped, plan assumes WT exists
- §11 Razorpay seam → migrations 040 carries `payment_method`/`payment_ref` columns; no further task ✓
- §12 v2 storefront → parked, plan is auth-agnostic via `MenuPage` props ✓
- §13 Open follow-ups — PM `pos_visible` (PM chat), schema name reconciliation (Task 1+2 resolves), Razorpay (future), v2 (future) ✓

**Type consistency check:** `SaleStatus`, `SaleChannel`, `FsmAction`, `CartLine`, `MenuProduct` are defined once each and re-used. `applyTransition` signature is consistent between Task 8 (server) and Task 15 (FE mirror diverges intentionally to `allowedActions` since FE doesn't need state-transition output).

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling" patterns. Implementer notes (e.g., "verify `client_levels` shape") flag known unknowns with concrete fallback guidance — not placeholders.

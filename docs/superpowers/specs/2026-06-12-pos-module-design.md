# POS Module — Design Spec

**Date:** 2026-06-12
**Branch:** `feat/pos-module-iso` (POS chat worktree: `../ExSol-POS-WT`)
**Scope:** v1 — staff-only in-store POS. Customer-facing storefront is parked for v2 (see `project_pos_v2_storefront.md`).
**Sibling chat ownership:** main / prod / integration. This chat does not push or merge.

---

## 1. Goal

Build a Point-of-Sale module that lets a logged-in client user (cashier / counter staff) take orders against the bucket's product catalog managed by the existing Product Manager module. The module ships three user-facing screens — **Menu**, **Cart**, **Sale History** — plus a state-machine for sale lifecycle. Payment is stubbed at v1 (cash mark only); Razorpay integration is designed-in but deferred.

Out of scope for v1:
- Customer accounts / customer login
- Public-facing storefront URL (v2 — see [v2 storefront memory](../../../../.claude/projects/-Users-faraaz-Desktop-Faraaz-Folder-Obsidian-MyBrain-ExSol-Code-Development-ExSol-Data-Collection-App/memory/project_pos_v2_storefront.md))
- Razorpay integration (stubbed)
- Per-line or cart-level discount
- Tax
- Per-line notes / modifiers
- Receipt printing / receipt email
- Refund money movement (state flip only)

## 2. Architecture overview

```
FRONTEND  (src/modules/pos/)
   /pos/menu         MenuPage          ──┐
   /pos/cart         CartPage          ──┤── useCartStore (zustand, persisted)
   /pos/sales        SalesListPage     ──┤   - lines (snapshot prices)
   /pos/sales/:id    SaleDetailDrawer  ──┘   - customer { name, phone, email }
                                            - channel { instore | online | pickup }
        │
        │  fetch with client-user JWT
        ▼
EDGE  (netlify/functions/pos/, per-function config.path)
   GET    /api/pos/menu
   POST   /api/pos/sales
   GET    /api/pos/sales
   GET    /api/pos/sales/:id
   POST   /api/pos/sales/:id/state
        │
        ▼
POSTGRES (Neon)
   migration 039: products.pos_visible BOOL DEFAULT true  (PM chat owns)
   migration 040: sales table + sale_status / sale_channel enums
   migration 041: sale_lines table
   migration 042: pos product + permission keys registered
   audit: existing audit_log table (migration 025) for FSM transitions
```

## 3. Module & registry surface

### 3.1 Frontend module tree

```
src/modules/pos/
├── PosRoutes.tsx              <Route path="/pos/*" element={<PosShell/>}>
├── api.ts                     fetch wrappers for /api/pos/*
├── store/
│   └── cart.ts                zustand store: lines, customer, channel
├── pages/
│   ├── MenuPage.tsx           /pos/menu
│   ├── CartPage.tsx           /pos/cart
│   ├── SalesListPage.tsx      /pos/sales
│   └── SaleDetailDrawer.tsx   rendered above SalesListPage
├── components/
│   ├── ProductTile.tsx
│   ├── MenuSearchBar.tsx
│   ├── CategoryTabs.tsx
│   ├── SideCartPanel.tsx
│   ├── CartLineRow.tsx
│   ├── CustomerForm.tsx
│   ├── ChannelPicker.tsx
│   ├── StatusPill.tsx
│   └── SaleStateButtons.tsx   FSM action buttons, perm-gated
├── lib/
│   ├── fsm.ts                 state-machine guards (canPay, canFulfill, canCancel, canRefund)
│   └── money.ts               format/parse paise ↔ rupee
└── __tests__/
    ├── cart-store.spec.ts
    ├── fsm.spec.ts
    ├── MenuPage.spec.tsx
    ├── CartPage.spec.tsx
    └── SalesListPage.spec.tsx
```

### 3.2 Registry slots

**`src/modules/registry/products-list/pos.ts`** — new product manifest:

```ts
export const posProduct: ProductManifest = {
  key: 'pos',
  name: 'POS',
  requires: ['products'],
  permissions: [
    { key: 'pos.menu.view',       label: 'View menu / add to cart' },
    { key: 'pos.sale.create',     label: 'Submit cart (creates pending sale)' },
    { key: 'pos.sale.markPaid',   label: 'Mark sale paid (cash)' },
    { key: 'pos.sale.fulfill',    label: 'Mark sale fulfilled (pickup/online)' },
    { key: 'pos.sale.cancel',     label: 'Cancel pending sale' },
    { key: 'pos.sale.refund',     label: 'Refund a paid/fulfilled sale' },
    { key: 'pos.history.view',    label: 'View own sale history' },
    { key: 'pos.history.viewAll', label: 'View all sales (any cashier)' },
  ],
}
```

Registry edits:
- `src/modules/registry/products.ts` — add `'pos': posProduct` entry
- `src/modules/registry/manifests/pos.ts` — new sidebar nav module manifest (visible when bucket has either `pos.menu.view` or `pos.history.view`)
- `src/modules/registry/modules.ts` — register the new manifest

### 3.3 Dependency enforcement

`requires: ['products']` is enforced two places:
1. **Registry helper:** `getProduct('pos')` exposes `requires` so the AMS enable-product flow can warn / block.
2. **Runtime:** `GET /api/pos/menu` checks `client_enabled_products` for `'products'` row and returns 412 if missing, with body `{ error: 'products_module_required' }`. FE shows a full-page error card.

## 4. Data model

All migrations are additive — no destructive reorder per `[Destructive migration order]` memory.

### 4.1 Migration 039 — `products.pos_visible` (PM chat owns)

```sql
ALTER TABLE products ADD COLUMN pos_visible BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX idx_products_pos_visible
  ON products(bucket_id, pos_visible) WHERE pos_visible = true;
```

**This migration is written by the PM chat**, not this chat. POS chat will surface a tiny follow-up prompt for the PM chat that pairs it with a "Show on POS menu" checkbox on the product form.

### 4.2 Migration 040 — `sales`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE sale_status  AS ENUM ('pending_payment','paid','fulfilled','cancelled','refunded');
CREATE TYPE sale_channel AS ENUM ('instore','online','pickup');

CREATE TABLE sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id       UUID NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
  order_no        INT  NOT NULL,
  status          sale_status  NOT NULL DEFAULT 'pending_payment',
  channel         sale_channel NOT NULL,

  -- customer (plain columns; no FK so v2 guest checkout writes the same shape)
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,

  -- money (paise)
  subtotal_cents  BIGINT NOT NULL,
  discount_cents  BIGINT NOT NULL DEFAULT 0,
  tax_cents       BIGINT NOT NULL DEFAULT 0,
  total_cents     BIGINT NOT NULL,

  -- audit
  created_by_user_node UUID NOT NULL REFERENCES user_nodes(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ,
  fulfilled_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  refunded_at     TIMESTAMPTZ,

  -- payment stub (Razorpay slot for v2)
  payment_method  TEXT,
  payment_ref     TEXT,

  CONSTRAINT sales_order_no_per_bucket UNIQUE (bucket_id, order_no),
  CONSTRAINT sales_phone_not_empty CHECK (length(trim(customer_phone)) > 0),
  CONSTRAINT sales_name_not_empty  CHECK (length(trim(customer_name))  > 0),
  CONSTRAINT sales_total_matches   CHECK (total_cents = subtotal_cents - discount_cents + tax_cents)
);

CREATE INDEX idx_sales_bucket_created   ON sales(bucket_id, created_at DESC);
CREATE INDEX idx_sales_bucket_status    ON sales(bucket_id, status);
CREATE INDEX idx_sales_bucket_channel   ON sales(bucket_id, channel);
CREATE INDEX idx_sales_bucket_creator   ON sales(bucket_id, created_by_user_node, created_at DESC);
CREATE INDEX idx_sales_phone_trgm       ON sales USING gin (customer_phone gin_trgm_ops);
```

`ON DELETE` choice for `created_by_user_node`: defaults to `NO ACTION`. Per the existing `[Team FK ON DELETE follow-up]` project memory, the bucket-wide pattern is to add a creator-deletion safeguard later; POS inherits whatever resolution that follow-up lands.

### 4.3 Migration 041 — `sale_lines`

```sql
CREATE TABLE sale_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id             UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name_snap   TEXT   NOT NULL,
  unit_price_cents    BIGINT NOT NULL,
  qty                 INT    NOT NULL CHECK (qty > 0),
  line_total_cents    BIGINT NOT NULL,
  position            INT    NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sale_lines_total_matches CHECK (line_total_cents = unit_price_cents * qty)
);

CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id, position);
```

`ON DELETE RESTRICT` for `product_id` prevents hard-deleting a product that has historic sale references — PM must use soft-delete or `pos_visible=false`.

### 4.4 Migration 042 — POS registry rows

The 8 permission keys and the `pos` product row are **fixed**. Only the table names below (`product_registry`, `product_permission_keys`) are placeholders — they'll be aligned to whatever shape `021_client_levels_permissions.sql` and `022_client_roles_bucket_family.sql` already use, during the implementation plan. Row content is final:

```sql
-- Register the new product
INSERT INTO product_registry (key, name, requires)
VALUES ('pos', 'POS', ARRAY['products']);

-- Register the 8 permission keys
INSERT INTO product_permission_keys (product_key, permission_key, label) VALUES
  ('pos','pos.menu.view',       'View menu / add to cart'),
  ('pos','pos.sale.create',     'Submit cart (creates pending sale)'),
  ('pos','pos.sale.markPaid',   'Mark sale paid (cash)'),
  ('pos','pos.sale.fulfill',    'Mark sale fulfilled (pickup/online)'),
  ('pos','pos.sale.cancel',     'Cancel pending sale'),
  ('pos','pos.sale.refund',     'Refund a paid/fulfilled sale'),
  ('pos','pos.history.view',    'View own sale history'),
  ('pos','pos.history.viewAll', 'View all sales (any cashier)');
```

### 4.5 Order number allocation

Per-bucket monotonic int, displayed as `S-00042` (zero-padded to 5 digits in FE only). Allocated inside the create-sale transaction:

```sql
SELECT COALESCE(MAX(order_no), 0) + 1
FROM sales
WHERE bucket_id = $1
FOR UPDATE;
```

`FOR UPDATE` row-locks against concurrent submits. Belt-and-suspenders: the `UNIQUE (bucket_id, order_no)` constraint catches any race that escapes the lock.

## 5. FSM (Sale lifecycle)

```
  draft ─submit─▶ pending_payment ─pay──▶ paid ──fulfill──▶ fulfilled
   (FE only)            │                  │                    │
                        │                  │                    └─refund─▶ refunded
                        └─cancel─▶ cancelled
```

| State | Meaning | Visible in Sale History |
|---|---|---|
| `draft` | Cart in progress (FE-only, never DB) | No |
| `pending_payment` | Cart submitted, awaiting payment | Yes |
| `paid` | Cash marked OR Razorpay success | Yes |
| `fulfilled` | Customer received goods | Yes |
| `cancelled` | Pending sale cancelled | Yes |
| `refunded` | Paid/fulfilled sale refunded (state only) | Yes |

### 5.1 Channel × state shortcut

- `channel = instore` → `markPaid` advances **status all the way to `fulfilled`** and stamps both `paid_at` and `fulfilled_at` in the same transaction. Single FE button: "Mark paid (cash) & complete". Two audit rows written: one for `pending_payment → paid`, one for `paid → fulfilled`.
- `channel = pickup` / `online` → `markPaid` flips to `paid` only; `fulfill` is a separate later call to flip to `fulfilled`.

### 5.2 Permission × state matrix

| Action | Required perm | Allowed from-states |
|---|---|---|
| `markPaid` | `pos.sale.markPaid` | `pending_payment` |
| `fulfill`  | `pos.sale.fulfill`  | `paid` |
| `cancel`   | `pos.sale.cancel`   | `pending_payment` |
| `refund`   | `pos.sale.refund`   | `paid`, `fulfilled` |

### 5.3 Error precedence (per `[API/UI error precedence]` memory)

For any FSM transition: **403 missing perm > 409 illegal state transition > 422 missing payment_method**. Explicit collision test in the spec: user without `markPaid` perm tries to pay an already-paid sale returns 403, not 409.

## 6. Backend endpoints

All under `netlify/functions/pos/`. Each handler declares `export const config = { path: '/api/pos/...' }` so the URL is documented next to the file (sidesteps `[Netlify function-name routing]` memory).

### 6.1 `GET /api/pos/menu`
- **Perm:** `pos.menu.view`
- **412** if `products` module not enabled for bucket
- **Returns:** `{ categories: [...], products: [...] }` — full catalog filtered by `pos_visible=true`, no pagination (FE filters in-memory)

### 6.2 `POST /api/pos/sales`
- **Perm:** `pos.sale.create`
- **Body:** `{ channel, customer: {name, phone, email?}, lines: [{productId, qty}], idempotencyKey }`
- **Single transaction:**
  1. Validate body (zod). Reject empty lines, qty ≤ 0, missing name/phone.
  2. Check idempotencyKey — if a sale with that key exists for this user in last 24h, return it.
  3. SELECT products `WHERE id IN (...) AND bucket_id = ? AND pos_visible = true`. Reject (400) on miss; 404 (not 403) on bucket mismatch (leak prevention).
  4. **Server snapshots `sale_price_cents` from products table** — ignores client-supplied prices.
  5. Compute totals.
  6. Allocate `order_no` with `FOR UPDATE`.
  7. Insert `sales` row (status=`pending_payment`) + `sale_lines` rows with `position`.
  8. Write `audit_log`: `action=pos.sale.created`.
- **Returns:** 201 with full sale row.

### 6.3 `GET /api/pos/sales`
- **Perm:** `pos.history.view` (always) + `pos.history.viewAll` (optional)
- **Query:** `status`, `channel`, `cashier`, `from`, `to`, `q`, `limit`, `cursor`
- Without `viewAll`, server forces `cashier = current_user_node`.
- `q` all-digit → match phone (trigram) OR `order_no`. Otherwise → name (ILIKE).
- **Returns:** `{ sales: SaleSummary[], nextCursor, summary: {count, revenueCents, pendingCount, pickupQueueCount} }`

### 6.4 `GET /api/pos/sales/:id`
- **Perm:** `pos.history.view`
- Without `viewAll`, other user's sale → **404** (not 403)
- **Returns:** sale + `sale_lines` (ordered by `position`) + audit_log entries

### 6.5 `POST /api/pos/sales/:id/state`
- **Body:** `{ action: 'markPaid'|'fulfill'|'cancel'|'refund', paymentMethod?: 'cash', reason?: string }`
- Permission × state matrix from §5.2; error precedence from §5.3
- Webhook-driven transitions (future Razorpay) bypass user perms — authenticated by HMAC instead
- Every transition writes an audit row with `before_status`, `after_status`, `user_node`, optional `reason`

## 7. Frontend behavior

### 7.1 Routes

- `/pos` → redirect to `/pos/menu`
- `/pos/menu` → `MenuPage`
- `/pos/cart` → `CartPage`
- `/pos/sales` → `SalesListPage` (drawer via `?sale=<id>` search-param)
- `/pos/sales/:id` → same page, drawer auto-opens

All under `<PosShell>`. Sidebar nav entry visible when bucket has `pos.menu.view` OR `pos.history.view`.

### 7.2 Cart store (`store/cart.ts`)

zustand, persisted to `localStorage` keyed by `bucketId + userNodeId` (no cross-user leak, refresh-safe).

```ts
type CartLine = { productId, productNameSnap, unitPriceCentsSnap, qty }

type CartState = {
  lines: CartLine[]
  customer: { name, phone, email }
  channel: 'instore' | 'online' | 'pickup'
  idempotencyKey: string  // generated on first addLine after clear()

  addLine(p), setQty(id, qty), removeLine(id),
  setCustomer(patch), setChannel(c), clear(),

  subtotalCents(), itemCount(),
  isValidForSubmit(): { ok: boolean, reason?: string }
}
```

Client snapshot is for display only — server reuses authoritative product price at submit. If they diverge, FE shows a "Prices were updated — review your cart" banner.

### 7.3 MenuPage

- Top: search input (debounced 150ms, client-side filter on name + category) + `<CategoryTabs>` chips
- Body: 3-col tile grid (3 col desktop / 2 col tablet / 1 col mobile)
- Side cart: `<SideCartPanel>` fixed ~220px right edge. Hidden when empty (replaced by "Tap items to start an order")
- Tile interactions: click → +1, shift-click → +5, tile shows ✓ + qty badge when in cart
- Empty state: when no products visible (PM disabled, no products, search no-match)
- `/` keybinding focuses search

### 7.4 CartPage

Dedicated `/pos/cart` route, two columns per locked mockup.

**Left:** `<CartLineRow>` per line (thumb / name / qty stepper / line total / × remove). Below: subtotal + total (bold). Zero-valued `discount_cents` and `tax_cents` rows are **not rendered** in v1 — they only appear if non-zero.

**Right:**
- `<CustomerForm>`: name + phone (required, blur-time validated per `c7f7d0c` convention), email optional with format check
- `<ChannelPicker>`: 3 pill buttons, instore default
- Submit: disabled until `isValidForSubmit().ok`. On success → `clear()` + navigate to `/pos/sales/:id`

Edge cases:
- Concurrent submit from another tab: server unique constraint catches; UI shows the response order_no
- Network failure mid-submit: error toast, cart NOT cleared, idempotency key prevents duplicate on retry

### 7.5 SalesListPage

- Header: title + "New Sale" → `/pos/menu`
- Filter bar: date range / status multi / channel multi / cashier select (hidden if no `viewAll`) / search
- 4 summary cards from endpoint `summary` block
- Table: virtualized if >100 rows
- Row click → updates URL to `/pos/sales/:id`, opens drawer

### 7.6 SaleDetailDrawer

Right-side drawer, ~480px. Sections:
1. Header: order #, status pill, channel badge, created-at, cashier
2. Customer: name, phone, email (mailto)
3. Lines: read-only table
4. Money: subtotal / discount / tax / total
5. Audit trail
6. `<SaleStateButtons>` — FSM actions allowed from current state, perm-gated

### 7.7 A11y / loading / errors

- All FSM action buttons: `aria-disabled` + tooltip explaining why (missing perm vs wrong state)
- Drawer: focus trap, ESC closes
- Menu first paint: skeleton tiles, capped at ~300ms before showing whatever loaded
- API errors: standard toast pattern from `src/modules/shared`
- 412 from menu endpoint: full-page error card with "Enable Products to use POS" CTA

## 8. Testing

### 8.1 Backend integration tests (`tests/pos/`)

| File | Key coverage |
|---|---|
| `menu.spec.ts` | `pos_visible` filter, 412 when PM disabled, 403 perm gate, bucket isolation |
| `sale-create.spec.ts` | Happy path, server-side price snapshot, parallel `order_no` allocation, empty lines (400), unknown product (400), cross-bucket (404), missing name/phone (400), idempotency dedup |
| `sales-list.spec.ts` | Filters, `viewAll` permission gate, phone vs name search, cursor pagination, summary math |
| `sale-detail.spec.ts` | Other-user sale → 404 not 403, lines in `position` order, audit trail |
| `sale-state.spec.ts` | One pass + one fail per transition, perm gates, error precedence collision (403 wins over 409), instore auto-fulfill, audit row on every transition |

### 8.2 Frontend tests (`src/modules/pos/__tests__/`)

| File | Coverage |
|---|---|
| `cart-store.spec.ts` | dedup, qty stepping, snapshot, validation, persistence key, clear-on-bucket-switch, idempotency-key lifecycle |
| `fsm.spec.ts` | Permission × state truth table for all 4 guard functions |
| `MenuPage.spec.tsx` | Search filter, category filter, empty state, tile-click adds |
| `CartPage.spec.tsx` | Blur validation, default channel, submit gate, idempotency key |
| `SalesListPage.spec.tsx` | Filter state in URL, drawer-on-row-click, `viewAll`-gated cashier filter |

### 8.3 Round-trip test

Create-sale → fetch-detail → assert snapshot fields preserved + totals match (matches `00cdba2` CSV pattern).

### 8.4 Per-task verification gates

Per `[Implementer must run typecheck]` memory, every implementer task ends with:
```
npm run typecheck && npm run test -- pos && npm run lint
```
Frontend smoke: `npm run dev` → log in → /pos/menu → add item → checkout → mark paid → confirm in /pos/sales.

## 9. Deployment plan

Respects `[Destructive migration order]`, `[Netlify deploy 4-item checklist]`, `[Prod migrations before promote]`, `[Verify Neon endpoint before drop]`.

All migrations 039–042 are **additive** → standard additive order:

1. Verify prod Neon endpoint hostname (`echo $DATABASE_URL | sed 's|.*@||; s|/.*||'`) — confirm `ep-<id>` matches expected prod branch.
2. Run `npm run migrate` against prod DATABASE_URL. (`npm run migrate` applies all pending migrations.)
3. PM chat commits 039 + the "Show on POS menu" checkbox in their worktree.
4. POS chat ships 040, 041, 042 + backend + frontend on `feat/pos-module-iso`.
5. Local netlify dev verification: `netlify dev --port=<unused> --target-port=<unused>` per `[Multi-worktree dev needs --target-port]`.
6. **No push from this chat.** Sibling chat handles main / prod / merge.
7. Post-deploy probe `/api/pos/menu` per `[Netlify new-function 404 → restore deploy]`. Run `netlify api restoreSiteDeploy` if 404.

## 10. Worktree

```
git worktree add ../ExSol-POS-WT -b feat/pos-module-iso main
```

All POS commits land on `feat/pos-module-iso` in the `../ExSol-POS-WT` worktree. The main checkout is read-only for this chat.

## 11. Razorpay seam (v2)

Designed-in slots for the future integration:
- `sales.payment_method` exists; v1 only writes `'cash'`
- `sales.payment_ref` exists; v1 writes NULL
- Future `netlify/functions/pos/razorpay-webhook.ts`:
  1. Verify HMAC
  2. Look up sale by `payment_ref` (Razorpay order ID stamped at sale-create time when `payment_method='razorpay'`)
  3. Call `sale-state` transition logic to advance to `paid`
- Webhook bypasses user perm gate (HMAC is its auth)

## 12. v2 — Public storefront (parked)

See `project_pos_v2_storefront.md`. v1 menu component is designed **auth-agnostic** (no `useAuth()` deep inside) so v2 wraps the same `MenuPage` + `CartPage` in a public route. Sale rows carry `channel='online'|'pickup'` and customer info as plain columns — no schema change needed for guest checkout.

## 13. Open follow-ups

- **PM chat (sibling):** add `pos_visible` checkbox to product form + migration 039
- **Schema name verification:** confirm registry table names (`product_registry`, `product_permission_keys` are placeholders) match existing 021/022 conventions before writing 042
- **Razorpay:** entire integration (`netlify/functions/pos/razorpay-webhook.ts`, FE payment-redirect, Razorpay JS SDK load, env vars for Razorpay key/secret per Netlify deploy checklist)
- **v2 storefront:** see [v2 memory](../../../../.claude/projects/-Users-faraaz-Desktop-Faraaz-Folder-Obsidian-MyBrain-ExSol-Code-Development-ExSol-Data-Collection-App/memory/project_pos_v2_storefront.md)

# POS v2 — Public Storefront Design Spec

**Date:** 2026-06-29
**Branch:** `feat/pos-v2-storefront-iso` (POS-v2 worktree: `../ExSol-POS-v2-WT`)
**Branched from:** `feat/pos-module-iso` @ `69df370` (carries all v1 code)
**Scope:** v2 — public, unauthenticated storefront for guest checkout against an opt-in tenant. Customers order online; staff marks paid on pickup using v1's existing FSM.
**Sibling chat ownership:** main / prod / integration. This chat does not push or merge.

---

## 1. Goal

Add a public-facing storefront that lets end customers browse a tenant's menu and submit orders without logging in. The submitted order lands in v1's existing Sale History as a `pending_payment` sale, attributed by `source='storefront'`. Staff sees it next to in-store sales and marks it paid on pickup using the v1 FSM. No Razorpay in v2 — payment happens at the counter.

**Out of scope for v2:**
- Razorpay (parked as v2.5; column seams `payment_method`, `payment_ref` already exist from v1)
- Customer accounts / login
- Order ETA / prep-time configuration
- Cloudflare Turnstile bot-defense (deferred per Q6)
- Per-tenant branding beyond tenant name (logos, colors, hero images)
- Storefront-specific permission keys
- Real-time SSE updates (20s polling sufficient)
- Multi-tenant subdomain routing — single domain, path-based (`/menu/<slug>`)

## 2. Architecture

```
┌── FRONTEND ──────────────────────────────────────────────────────────┐
│  Public (no auth)                                                    │
│   /menu/:slug                  StorefrontMenuPage  ┐                 │
│   /menu/:slug/cart             StorefrontCartPage  ├── reuses v1     │
│   /menu/:slug/details          StorefrontDetails   │   MenuPage,     │
│   /menu/:slug/order/:saleUuid  StorefrontReceipt   │   CartPage      │
│                                                    │   components    │
│  Cart store: createGuestCartStore(clientId, sess)  ┘                 │
│  Storage: sessionStorage (per-tab); key:                             │
│           "pos-cart-guest:<clientId>:<sessionUuid>"                  │
│  Session UUID: crypto.randomUUID() on first MenuPage render,         │
│           stashed at "pos-storefront-session" in sessionStorage      │
│                                                                      │
│  Authed (existing)                                                   │
│   /c/:slug/settings   → new "Public storefront" toggle (L1 owner)    │
└──────────────────┬───────────────────────────────────────────────────┘
                   │  fetch /api/public/*  (NO JWT)
                   ▼
┌── EDGE (Netlify Functions, FLAT layout per v1 deploy fix) ───────────┐
│  pub-menu.ts          GET  /api/public/menu/:slug                    │
│  pub-sale-create.ts   POST /api/public/sales                         │
│  pub-sale-detail.ts   GET  /api/public/sales/:saleUuid               │
│  _pub-authz.ts        (slug→client_id + storefront_enabled guard)    │
│  _pub-ratelimit.ts    (Netlify Blobs counter, two-layer IP cap)      │
│  _pub-validators.ts   (tighter zod bounds + honeypot)                │
│                                                                      │
│  client-settings-storefront.ts                                       │
│                       PATCH /api/client-settings/storefront          │
│                       (L1 owner toggles storefront_enabled)          │
└──────────────────┬───────────────────────────────────────────────────┘
                   │
                   ▼
┌── POSTGRES (Neon) ───────────────────────────────────────────────────┐
│  mig 043  clients.storefront_enabled BOOLEAN DEFAULT false           │
│  mig 044  products.storefront_visible BOOLEAN DEFAULT true           │
│  mig 045  sales.created_by_user_node → NULLABLE                      │
│           sales.source TEXT NOT NULL DEFAULT 'pos'                   │
│              CHECK source IN ('pos','storefront')                    │
│              CHECK (source='pos'  AND created_by_user_node IS NOT NULL) │
│                 OR (source='storefront' AND created_by_user_node IS NULL)│
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 Key design decisions (locked during brainstorm)

| Q | Decision | Why |
|---|---|---|
| Q1 | Pay-on-pickup. No Razorpay in v2. | Storefront ships sooner without payment-integration risk. Razorpay = v2.5 with seams already in place. |
| Q2 | Opt-in per tenant (`clients.storefront_enabled BOOLEAN DEFAULT false`). | Online orders are a business decision, not a software default. One boolean. |
| Q3 | Per-product `storefront_visible BOOLEAN DEFAULT true`. | Two real surfaces (POS, storefront) = two booleans. Cheaper than array, more expressive than reusing `pos_visible`. |
| Q4 | `sales.source` + nullable `created_by_user_node` + CHECK constraint. | No synthetic user_nodes polluting the team tree. DB-enforced invariant. |
| Q5 | Receipt URL = `/menu/:slug/order/:saleUuid` (UUID bearer). 20s polling auto-stops at terminal states. | UUIDs are sufficient bearer tokens. Polling beats SSE for v2 scale. |
| Q6 | Two-layer IP rate limit + honeypot + tightened zod bounds. No Turnstile. | Cheapest defense with no third-party signup. Turnstile = v2.5. |
| Q7 | New `StorefrontMenuPage`/`StorefrontCartPage` wrappers. `createGuestCartStore` with sessionStorage. | Clean namespace, no flag-args. sessionStorage = standard ecommerce expectation. |
| Q8 | L1 owner toggles in `/c/:slug/settings`. Unknown + disabled both 404 with same code. Enabled state shows URL + copy. | Self-serve via existing `_platform.settings.edit`. Anti-leak parity. |

## 3. Module & route surface

### 3.1 Frontend module tree (additions)

```
src/modules/pos/
├── pages/StorefrontMenuPage.tsx       NEW — thin wrapper around MenuPage
├── pages/StorefrontCartPage.tsx       NEW — wrapper around CartPage; channel = pickup/delivery only
├── pages/StorefrontDetailsPage.tsx    NEW — name/phone/email + hidden honeypot
├── pages/StorefrontReceiptPage.tsx    NEW — order_no, lines, status, 20s poll
├── pages/StorefrontShell.tsx          NEW — chromeless layout, tenant header
├── store/cart.ts                      EXTEND — add createGuestCartStore (sessionStorage)
├── api.ts                             EXTEND — add publicApi.{getMenu, createSale, getSale}
├── lib/session.ts                     NEW — getOrCreateStorefrontSession() per-tab UUID
└── PublicStorefrontRoutes.tsx         NEW — mounted outside /c/:slug

src/modules/user-portal/settings/
└── StorefrontSettings.tsx             NEW — toggle + URL display + copy button
```

### 3.2 Backend function tree (FLAT layout per v1 deploy fix)

```
netlify/functions/
├── pub-menu.ts                     GET   /api/public/menu/:slug
├── pub-sale-create.ts              POST  /api/public/sales
├── pub-sale-detail.ts              GET   /api/public/sales/:saleUuid
├── _pub-authz.ts                   slug-resolver + storefront_enabled guard
├── _pub-ratelimit.ts               Netlify Blobs two-layer IP rate limiter
├── _pub-validators.ts              zod schemas with tighter bounds + honeypot
└── client-settings-storefront.ts   PATCH /api/client-settings/storefront
```

Every handler declares both `config.path` AND `config.method` to avoid the v1 collision trap.

### 3.3 Public routes (mounted OUTSIDE `/c/:slug/`)

In `src/lib/router.tsx`:
```tsx
{ path: '/menu/:slug',                 element: <StorefrontMenuPage /> },
{ path: '/menu/:slug/cart',            element: <StorefrontCartPage /> },
{ path: '/menu/:slug/details',         element: <StorefrontDetailsPage /> },
{ path: '/menu/:slug/order/:saleUuid', element: <StorefrontReceiptPage /> },
```

The `<StorefrontShell>` is rendered inside each page (not as a layout route) because the four pages have slightly different chrome (e.g., receipt has no header search bar).

### 3.4 Registry surface

**No new product, no new permission keys.** The storefront has no client-user-visible permissions because customers aren't client users. Enabling/disabling uses the existing `_platform.settings.edit` permission (L1 owners always hold it).

## 4. Data model

All three migrations are **additive** (no destructive reorder per `[Destructive migration order]`).

### 4.1 Migration 043 — `clients.storefront_enabled`

```sql
alter table public.clients
  add column if not exists storefront_enabled boolean not null default false;
```

No index — `clients` is small and slug lookups are already indexed.

### 4.2 Migration 044 — `products.storefront_visible`

```sql
alter table public.products
  add column if not exists storefront_visible boolean not null default true;

create index if not exists idx_products_client_storefront_visible
  on public.products (client_id, storefront_visible)
  where storefront_visible = true and deleted_at is null;
```

Partial filtered index matching the always-true `WHERE` predicate of the storefront menu query.

### 4.3 Migration 045 — `sales.source` + nullable `created_by_user_node`

```sql
alter table public.sales
  alter column created_by_user_node drop not null;

alter table public.sales
  add column if not exists source text not null default 'pos'
    check (source in ('pos', 'storefront'));

alter table public.sales
  add constraint sales_source_attribution_consistent check (
    (source = 'pos'        and created_by_user_node is not null) or
    (source = 'storefront' and created_by_user_node is null)
  );

create index if not exists idx_sales_bucket_source
  on public.sales (bucket_id, source, created_at desc);
```

Backfill: existing rows already have `created_by_user_node IS NOT NULL`, so `source` defaults to `'pos'` and the new CHECK passes. The `IS NULL` half of the CHECK only applies to new storefront rows.

### 4.4 Order_no allocation: unchanged

V1's per-bucket monotonic `order_no` with `FOR UPDATE` + 23505 retry continues. Storefront sales get the next number in the same bucket sequence (no separate counter — a customer's `S-00042` could be a guest order or an in-store order; the bucket cashier sees both in the same Sale History).

## 5. Backend endpoints

### 5.1 `GET /api/public/menu/:slug` (`pub-menu.ts`)

```ts
export const config = { path: '/api/public/menu/:slug', method: 'GET' };
```

**Auth:** none.

**Handler order:**
1. Rate limit: 60 menu fetches per IP per minute via `_pub-ratelimit.ts`. 429 if exceeded.
2. `_pub-authz.ts` resolves slug: `SELECT id, name, storefront_enabled FROM clients WHERE slug = $1`.
3. If row missing OR `storefront_enabled = false` → **404 `storefront_unavailable`**.
4. Verify both `'products'` and `'pos'` enabled in `client_enabled_products`. Otherwise → same 404 code.
5. Load categories + products `WHERE client_id = ? AND storefront_visible = true AND status = 'active' AND deleted_at IS NULL`.

**Response:**
```ts
{
  tenant: { name: string },         // internal client.id is NOT exposed
  categories: { id, name, productCount }[],
  products:   { id, name, categoryId, salePriceCents, thumbKey }[]
}
```

(The internal `client.id` is intentionally NOT exposed in the response. The FE uses `slug` itself as the cart-store key prefix — see §6.5 — so it never needs the UUID. The submit endpoint resolves slug → client_id server-side.)

**Headers:** `Cache-Control: public, max-age=30` — gentle scraper resistance, fresh enough for customers.

### 5.2 `POST /api/public/sales` (`pub-sale-create.ts`)

```ts
export const config = { path: '/api/public/sales', method: 'POST' };
```

**Auth:** none.

**Body:**
```ts
{
  slug: string,
  channel: 'online' | 'pickup',
  idempotencyKey: string,          // === session UUID; reused on retry
  honeypot: string,                 // must be ''
  customer: { name, phone, email? },
  lines: [{ productId, qty }]
}
```

**Handler order (matters):**
1. Rate limit: global 10/min/IP + per-slug 3/10min/IP. 429 if either exceeded.
2. Honeypot check: if `honeypot !== ''` → **return 200 with a fake-success body**. No DB write, no audit. (Silent success hides the detection from bots.)
3. Validate body via `PublicSaleCreateBody` (`_pub-validators.ts`):
   - `lines.min(1).max(50)`, `qty.int().positive().max(99)`
   - `customer.name.max(120)`, `customer.phone.max(20)`, `customer.email.max(254)` optional
   - `channel.in(['online', 'pickup'])` — `'instore'` rejected at the type layer
   - `honeypot.max(0)` — also defensive at the schema
4. Slug resolution + storefront_enabled check (same as menu) → 404 if missing/disabled.
5. Idempotency: `WHERE bucket_id = ? AND payment_ref = 'idem:' || $key AND created_at > now() - interval '24 hours'`. If found → return existing sale.
6. Hydrate products with visibility filter (`storefront_visible=true AND status='active' AND deleted_at IS NULL`):
   - Missing product → 400 `unknown_product`
   - Cross-client product → 404 `product_not_found` (leak guard)
   - Visibility filter fail → 400 `product_not_visible`
7. Snapshot server-side prices (`COALESCE(sale_price_cents, price_cents)`), allocate `order_no` (per-bucket MAX+1 with 23505 retry), insert sale with:
   - `source = 'storefront'`
   - `created_by_user_node = NULL`
   - `payment_method = NULL`
   - `status = 'pending_payment'`
   - `payment_ref = 'idem:' || idempotencyKey`
8. Bulk insert sale_lines.
9. Audit row via `logAudit`: `op = 'pos.sale.created'`, `actor_user_node = NULL`, `actor_admin = NULL`, `detail = { source: 'storefront', total, channel, lines: N }`.

**Returns 201** with the same whitelisted shape as §5.3 (id, orderNo, status, channel, customer, totals, lines, timeline). Internal columns (`bucket_id`, `source`, `payment_ref`) are not exposed. The FE uses `sale.id` to navigate to `/menu/:slug/order/:sale.id`.

### 5.3 `GET /api/public/sales/:saleUuid` (`pub-sale-detail.ts`)

```ts
export const config = { path: '/api/public/sales/:saleUuid', method: 'GET' };
```

**Auth:** UUID is the bearer token.

**Handler order:**
1. Rate limit: 60/min/IP (polling-friendly).
2. `SELECT … FROM sales WHERE id = $1 AND source = 'storefront'`. **Both conditions required.** A v1 in-store sale UUID returns 404 — leak guard.
3. Receipt URL works even if the tenant disabled the storefront after issuance (bearer-token kindness). No `storefront_enabled` check on this endpoint.
4. Return a **whitelisted** subset of the sale row — internal columns (`bucket_id`, `created_by_user_node`, `payment_ref`, audit fields) are NOT in the response shape. Customer sees:
```ts
{
  id: string,                            // sale UUID (already in their URL)
  orderNo: number,                       // displayed as S-NNNNN by formatOrderNo
  status: SaleStatus,
  channel: 'online' | 'pickup',
  customer: { name, phone, email },      // their own info, echoed back
  subtotalCents, discountCents, taxCents, totalCents,
  lines: {
    productNameSnap: string,             // snapshot at sale time
    unitPriceCents: number,
    qty: number,
    lineTotalCents: number,
    position: number,
  }[],
  timeline: {                             // compact timestamps; no cashier identity
    placedAt: created_at,
    paidAt: paid_at,                      // null until staff marks paid
    fulfilledAt: fulfilled_at,
    cancelledAt: cancelled_at,
    refundedAt: refunded_at,
  }
}
```

Notably absent from the response: `bucket_id`, `created_by_user_node`, `source`, `payment_method`, `payment_ref`, the `audit_log` rows for this sale. Customers don't need them and shouldn't see them.

### 5.4 `PATCH /api/client-settings/storefront` (`client-settings-storefront.ts`)

```ts
export const config = { path: '/api/client-settings/storefront', method: 'PATCH' };
```

**Auth:** bucket-user JWT + `_platform.settings.edit` permission.

**Body:** `{ enabled: boolean }`.

**Handler:**
1. `requireBucketUser` + permission check.
2. `UPDATE clients SET storefront_enabled = $1 WHERE id = bucketId RETURNING slug, storefront_enabled`.
3. Audit row: `op = 'client.storefront_toggled'`.

**Returns:** `{ enabled, publicUrl }` where `publicUrl` is computed `${PUBLIC_BASE_URL}/menu/${slug}` (env-var `PUBLIC_BASE_URL` set per Netlify context; production = `https://exsol.app`).

### 5.5 V1 endpoint updates

| Endpoint | Tweak |
|---|---|
| `pos-sales-list.ts` | Add `source` to SELECT + response shape. Without `pos.history.viewAll`, storefront rows hidden (only own POS sales). With `viewAll`, both shown together. |
| `pos-sale-detail.ts` | Adjust leak guard: `(created_by_user_node !== userNodeId AND source !== 'storefront') → 404`. Storefront sales visible to anyone with `pos.history.view` (no cashier "owns" them). |
| `pos-sale-state.ts` | No change. FSM transitions work identically on storefront-attributed sales. |

## 6. Frontend behavior

### 6.1 `lib/session.ts`

```ts
const KEY = 'pos-storefront-session';
export function getOrCreateStorefrontSession(): string {
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
}
```

### 6.2 `store/cart.ts` extension

```ts
export function createGuestCartStore(bucketId: string, sessionId: string) {
  const storageKey = `pos-cart-guest:${bucketId}:${sessionId}`;
  return create<CartState>()(
    persist(/* same factory body as createCartStore */, {
      name: storageKey,
      storage: createJSONStorage(() => sessionStorage),   // ← NOT localStorage
    }),
  );
}
```

### 6.3 `api.ts` extension — `publicApi`

```ts
export const publicApi = {
  getMenu:    (slug: string)            => call<PublicMenuResponse>(`/api/public/menu/${slug}`),
  createSale: (body: PublicSaleInput)   => call<any>('/api/public/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  getSale:    (saleUuid: string)        => call<any>(`/api/public/sales/${saleUuid}`),
};
```

`call<T>` and `PosApiError` are unchanged from v1.

### 6.4 `StorefrontShell.tsx`

Chromeless layout: a branded header with the tenant name (passed from the menu response), no sidebar, no UserAuth context. Returns a friendly "Online ordering is not available for this URL" card when the inner page reports a 404 from any public endpoint.

### 6.5 `StorefrontMenuPage.tsx`

```tsx
function StorefrontMenuPage() {
  const { slug } = useParams();
  const [tenant, setTenant] = useState<{name: string} | null>(null);
  const [error, setError]   = useState<PosApiError | null>(null);
  const sessionId = getOrCreateStorefrontSession();

  useEffect(() => {
    publicApi.getMenu(slug!)
      .then((r) => setTenant({ name: r.tenant.name }))
      .catch((e) => setError(e));
  }, [slug]);

  if (error) return <StorefrontShell><NotAvailableCard /></StorefrontShell>;
  if (!tenant) return <StorefrontShell>Loading…</StorefrontShell>;

  // bucketId prop receives the SLUG, not the internal UUID. The store key
  // becomes `pos-cart-guest:<slug>:<sessionId>`, which is fine — the key
  // only needs to be stable per (tenant, tab). The submit endpoint
  // resolves slug → client_id server-side, so the FE never holds the UUID.
  return (
    <StorefrontShell tenantName={tenant.name}>
      <MenuPage bucketId={slug!} userNodeId={`guest-${sessionId}`} slug={slug!} />
    </StorefrontShell>
  );
}
```

The v1 `MenuPage` already calls `createCartStore(bucketId, userNodeId)` — to switch it to the guest store, we update `createCartStore` to detect the `'guest-'` prefix and route to `createGuestCartStore`. Alternative: explicit prop. **Going with prefix-detection** to minimize prop surface on the v1 component:

```ts
// store/cart.ts
export function createCartStore(bucketId: string, userNodeId: string) {
  if (userNodeId.startsWith('guest-')) {
    return createGuestCartStore(bucketId, userNodeId.slice('guest-'.length));
  }
  // existing v1 logic
}
```

This keeps the v1 `MenuPage`/`CartPage` props identical; the only "magic" is the `guest-` prefix convention.

### 6.6 `StorefrontCartPage.tsx`

Renders the v1 `CartPage` component with two modifications via new optional props on `CartPage`:
- `hideCustomerForm: true` — collapses the customer-form column; "Continue" navigates to `/menu/:slug/details` instead of submitting.
- `channelOptions: ['pickup', 'online']` — channel picker hides "Instore."

### 6.7 `StorefrontDetailsPage.tsx`

Standalone form (does NOT reuse v1 `CustomerForm` because the honeypot needs to live in this form):
```tsx
function StorefrontDetailsPage() {
  const { slug } = useParams();
  const sessionId = getOrCreateStorefrontSession();
  const cartStore = createGuestCartStore(tenantId, sessionId);
  // ...
  const [honeypot, setHoneypot] = useState('');
  // ...
  return (
    <form onSubmit={submit}>
      <input name="name"  ... />
      <input name="phone" ... />
      <input name="email" ... />
      <input
        name="company"
        defaultValue=""
        onChange={(e) => setHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-10000px', opacity: 0, pointerEvents: 'none' }}
      />
      <button>Place Order</button>
    </form>
  );
}
```

On submit:
```ts
const sale = await publicApi.createSale({
  slug, channel, customer, lines, honeypot, idempotencyKey: sessionId
});
clearGuestCart(tenantId, sessionId);
navigate(`/menu/${slug}/order/${sale.id}`);
```

### 6.8 `StorefrontReceiptPage.tsx`

```tsx
function StorefrontReceiptPage() {
  const { saleUuid } = useParams();
  const [sale, setSale] = useState<any>(null);
  const [error, setError] = useState<PosApiError | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const s = await publicApi.getSale(saleUuid!);
        if (cancelled) return;
        setSale(s);
        // Auto-stop polling on terminal states
        if (['fulfilled','cancelled','refunded'].includes(s.status)) {
          stopRef.current = true;
        }
      } catch (e) {
        setError(e as PosApiError);
        stopRef.current = true;
      }
    }
    fetchOnce();
    const t = setInterval(() => { if (!stopRef.current) fetchOnce(); }, 20_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [saleUuid]);

  // …render order_no, lines, status pill, customer block, inline timeline strip
}
```

Inline timeline strip: a one-line series of timestamps (`Placed 2:32 · Paid 2:47 · Fulfilled 2:50`) computed from the `timeline` object in the response. Skipped entries don't render.

### 6.9 `StorefrontSettings.tsx` (workspace settings)

Renders inside `/c/:slug/settings` when the user has `_platform.settings.edit`:

```tsx
<section className="storefront-settings">
  <h3>Public Storefront</h3>
  <Toggle
    checked={enabled}
    onChange={async (v) => {
      const r = await fetch('/api/client-settings/storefront', {
        method: 'PATCH', credentials: 'include',
        body: JSON.stringify({ enabled: v }),
      });
      const { enabled: newEnabled, publicUrl } = await r.json();
      setEnabled(newEnabled);
      setUrl(publicUrl);
    }}
  />
  {enabled && url && (
    <div>
      Your storefront: <code>{url}</code>
      <button onClick={() => navigator.clipboard.writeText(url)}>Copy</button>
    </div>
  )}
</section>
```

### 6.10 Router wiring

In `src/lib/router.tsx`, additions to the top-level `createBrowserRouter` array (siblings of the existing `/c/:slug` block, NOT children):

```tsx
{ path: '/menu/:slug',                 element: <StorefrontMenuPage /> },
{ path: '/menu/:slug/cart',            element: <StorefrontCartPage /> },
{ path: '/menu/:slug/details',         element: <StorefrontDetailsPage /> },
{ path: '/menu/:slug/order/:saleUuid', element: <StorefrontReceiptPage /> },
```

## 7. Anti-abuse

### 7.1 `_pub-ratelimit.ts`

Netlify Blobs counter — Functions don't share memory per `[Netlify Functions don't share memory]`.

```ts
const blobs = getStore('pub-ratelimit');

async function increment(key: string, ttlSeconds: number): Promise<number> {
  const current = Number(await blobs.get(key) ?? 0);
  const next = current + 1;
  await blobs.setJSON(key, next, { metadata: { expires: Date.now() + ttlSeconds * 1000 } });
  return next;
}

export async function checkLimit(ip: string, endpointKey: string, opts: {
  perMinute: number, perSlugIp?: { slug: string, per10min: number }
}): Promise<{ ok: true } | { ok: false, code: string }> {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const key1 = `rl:ip:${ip}:${endpointKey}:${minuteBucket}`;
  const n1 = await increment(key1, 120);
  if (n1 > opts.perMinute) return { ok: false, code: 'rate_limit_ip' };

  if (opts.perSlugIp) {
    const tenMinuteBucket = Math.floor(Date.now() / 600_000);
    const key2 = `rl:slug:${opts.perSlugIp.slug}:${ip}:${tenMinuteBucket}`;
    const n2 = await increment(key2, 1200);
    if (n2 > opts.perSlugIp.per10min) return { ok: false, code: 'rate_limit_slug' };
  }
  return { ok: true };
}
```

Per `[Blob mock propagation on handler change]`: every test file that exercises these handlers must mock `getStore`.

### 7.2 Honeypot

The `name="company"` field is hidden via CSS + ARIA + tab-index. Real users never see it; bots filling all visible inputs will. Server: any non-empty value → return 200 fake-success without writing to DB or audit. This silently degrades the bot's tooling.

### 7.3 Tightened zod bounds — `_pub-validators.ts`

```ts
export const PublicSaleCreateBody = z.object({
  slug: z.string().min(1).max(120),
  channel: z.enum(['online', 'pickup']),
  idempotencyKey: z.string().min(8).max(64),
  honeypot: z.string().max(0),  // empty-string only
  customer: z.object({
    name:  z.string().refine((s) => s.trim().length > 0).pipe(z.string().max(120)),
    phone: z.string().refine((s) => s.trim().length > 0).pipe(z.string().max(20)),
    email: z.string().email().max(254).optional(),
  }),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    qty: z.number().int().positive().max(99),
  })).min(1).max(50),
});
```

Separate from v1's `SaleCreateBody` to avoid disturbing v1 test expectations.

## 8. Testing

### 8.1 Backend tests — `tests/pos/`

| File | Coverage |
|---|---|
| `pub-menu.spec.ts` | `storefront_visible=true` filter; tenant name returned; 404 for unknown/disabled/POS-disabled (all `storefront_unavailable`); `Cache-Control: public, max-age=30` set; rate limit 60/min/IP. |
| `pub-sale-create.spec.ts` | Happy path → `source='storefront'`, `created_by_user_node=NULL`, audit row written. Honeypot non-empty → 200 fake success, no DB write. `channel='instore'` → 400. Idempotency via session UUID. Server-side price snapshot. Cross-client product → 404. `storefront_visible=false` product → 400. Zod bounds (qty=100 → 400, 51 lines → 400). Rate limits (10/min/IP + 3/10min/slug-IP). |
| `pub-sale-detail.spec.ts` | Returns sale + lines + compact timeline. **POS sale UUID → 404** (leak guard). After tenant disables storefront, existing order still 200. Compact timeline shape; no audit_log entries leaked. |
| `client-settings-storefront.spec.ts` | L1 owner toggles; PATCH returns the public URL. Lacking `_platform.settings.edit` → 403. |
| `pos-sales-list.spec.ts` (modify) | New `source` field per row. Without `viewAll`, storefront rows hidden. With `viewAll`, both shown. |
| `pos-sale-detail.spec.ts` (modify) | Cashier without `viewAll` can view a storefront-source sale (different rule than for POS sales). |

### 8.2 Frontend tests — `src/modules/pos/__tests__/`

| File | Coverage |
|---|---|
| `guest-cart-store.spec.ts` | `createGuestCartStore` uses sessionStorage. Key shape `pos-cart-guest:<tenant>:<session>`. Tab-close (mocked) = cart lost. |
| `cart-store-prefix.spec.ts` | `createCartStore('b','guest-X')` routes to `createGuestCartStore('b','X')`. `createCartStore('b','u1')` stays on the v1 path. |
| `lib/session.spec.ts` | `getOrCreateStorefrontSession()` returns same UUID on repeat; new UUID after sessionStorage clear. |
| `StorefrontMenuPage.spec.tsx` | Renders tenant name. Forwards to `MenuPage` with computed props. 404 from menu → friendly card. |
| `StorefrontCartPage.spec.tsx` | Channel picker shows only Pickup/Online (no Instore). "Continue" → `/menu/:slug/details`. |
| `StorefrontDetailsPage.spec.tsx` | Honeypot input present and hidden. Submit sends `honeypot: ''`. Blur-validate name + phone. Email format optional. Success → navigate + clearGuestCart. |
| `StorefrontReceiptPage.spec.tsx` | Polls every 20s. Auto-stops at `fulfilled`/`cancelled`/`refunded`. Renders order_no via `formatOrderNo`. Inline timeline strip from `*_at` fields. |
| `StorefrontSettings.spec.tsx` | Toggle round-trip; copy-button shows enabled URL; perm-gated. |

### 8.3 Round-trip — `tests/pos/storefront-round-trip.spec.ts`

Public menu → public create → public detail (initial poll) → cashier marks paid via v1 `pos-sale-state` (instore auto-fulfills, but storefront uses pickup so stays at `paid`) → public detail reflects status change on next poll.

### 8.4 Verification gate

Every implementer task ends with:
```bash
npm run typecheck && npx vitest run && npm run lint
```

Plus the two sanity greps codified after the v1 deploy fix:
```bash
# Flat layout
find netlify/functions -name '*.ts' -not -path '*/_shared/*' | awk -F/ '{print NF}' | sort -u
# → must be 3

# (path, method) uniqueness
grep -rE "^export const config" netlify/functions/ | grep -oE "(path: ['\"][^'\"]+['\"](, method: ['\"][^'\"]+['\"])?)" | sort | uniq -d
# → must be empty
```

Manual smoke (`npm run dev` per `[Multi-worktree dev needs --target-port]`):
- Toggle storefront ON via the settings page.
- Browse `/menu/<slug>` in a new tab → see menu.
- Add items, continue to details, submit.
- Receipt page polls; visible `Placed at <time>` timestamp.
- In another tab, log in as L1 owner → mark paid → switch back to receipt tab → status updates within 20s.

## 9. Deployment plan

Respects: `[Destructive migration order]`, `[Netlify deploy 4-item checklist]`, `[Prod migrations before promote]`, `[Verify Neon endpoint before drop]`, `[Netlify subdir function discovery]`, `[Netlify config.path × config.method]`, `[Netlify new-function 404 → restore deploy]`.

All 3 migrations are additive → standard order:

1. Verify prod Neon endpoint host (`echo $DATABASE_URL | sed 's|.*@||; s|/.*||'` → confirm `ep-<id>`).
2. `npm run migrate` against prod DATABASE_URL.
3. Push `feat/pos-v2-storefront-iso` → merge to main → Netlify auto-deploys.
4. **Post-deploy probe** (curl the new functions to catch silent-discovery failure — the v1 trap):
   ```
   curl -sS https://<host>/.netlify/functions/pub-menu -H 'X-Probe: 1'
   ```
   Expect a JSON error (not SPA HTML 200). If SPA HTML → repeat the v1 flatten audit; if 404 with proper JSON → `netlify api restoreSiteDeploy`.
5. Real end-to-end probe: open `/menu/<a-test-slug-with-storefront_enabled=true>` in incognito.
6. Set `PUBLIC_BASE_URL` env var in Netlify production context (per `[Netlify deploy 4-item checklist]`).

**No push from this chat.** Sibling chat owns main/prod.

## 10. Worktree

```
git worktree add ../ExSol-POS-v2-WT -b feat/pos-v2-storefront-iso feat/pos-module-iso
# Base = 69df370 (v1 with deploy fix)
```

When v1 lands on main, rebase v2 onto main; nothing in v2 depends on v1's deploy-fix specifics beyond inheriting the v1 file layout.

## 11. Razorpay seam (v2.5)

When Razorpay lands:
1. FE: on `StorefrontDetailsPage` submit, branch on tenant config (`payment_method: 'razorpay'`). Sale row written with `payment_ref = <razorpay-order-id>` and `status = 'pending_payment'`.
2. FE redirects to Razorpay checkout with the order ID.
3. New webhook function `pos-razorpay-webhook.ts` verifies HMAC, looks up sale by `payment_ref`, advances state to `paid` via the same `applyTransition` logic.
4. Customer redirected back to `/menu/:slug/order/:saleUuid` which polls and reflects new status.

Zero schema changes. The webhook is the only new file.

## 12. Open follow-ups

- **PM chat (sibling):** add the `storefront_visible` checkbox to the product form (alongside the existing `pos_visible` checkbox). Default true.
- **L1 owner settings UX:** if `/c/:slug/settings` doesn't yet have a section structure, this v2 work introduces one. Cross-check Login+AMS chat's settings scope.
- **Razorpay (v2.5):** entire integration — env vars per Netlify context, webhook HMAC verify, FE redirect flow.
- **Cloudflare Turnstile (v2.5):** account + site keys + env vars + FE widget + server-side verify call. Only if abuse appears.
- **Per-tenant branding (v3):** logo upload, color palette, hero image.

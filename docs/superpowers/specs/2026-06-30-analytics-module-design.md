# Analytics Module — Design

**Date:** 2026-06-30
**Branch / worktree:** `feat/analytics-module-iso` · `../ExSol-Analytics-WT`
**Status:** Design approved (sections 1–9), pending written-spec review → implementation plan.
**Scope discipline:** Analytics Module only. No push, no merge to `main`, no cross-module
integration in this chat (sibling chat owns prod/integration).

---

## 1. Purpose & shape

A cross-module, **read-only** analytics surface for the ExSol ERP. Dashboard-first:
visual KPI tiles + trend/breakdown charts viewed live in-app, with per-panel export.
Covers all available data domains — Sales, Bookings, Customers, Team, Catalog —
built on one pluggable framework so domains are configuration, not bespoke pages.

This is a complete module, not a staged teaser. Build *order* is sequenced
(Sales → Bookings → Customers → Team → Catalog) so each lands green, but the
deliverable is the whole module.

### Industry-standard framing

Standard ERP analytics (SAP Analytics Cloud, NetSuite SuiteAnalytics, Dynamics 365,
Odoo, Zoho) is built in three layers, all present here:

- **Layer 1 — functional dashboards** per business domain (Sales, Operations,
  Customer, Workforce, Catalog).
- **Layer 2 — cross-cutting capabilities**: KPI scorecards, time-series trends,
  period-over-period comparison, drill-down, segmentation/filtering, export.
- **Layer 3 — architecture & governance**: read-only aggregation, role-based data
  scoping, embedded in the app.

## 2. Approach

**Approach A — live on-the-fly SQL aggregation + Recharts.** Chosen over
pre-aggregated rollup tables (premature for SMB data volume; introduces
staleness/sync bugs) and external/embedded BI (data egress, RBAC doesn't map).

- Each domain endpoint runs `GROUP BY` queries against operational tables at request
  time, using indexes that already exist (`idx_sales_bucket_created`,
  `idx_sales_bucket_creator`, `idx_sales_bucket_channel`, `bookings_bucket_status_idx`,
  `bookings_user_node_idx`).
- **Analytics owns no tables at all** — a pure read-projection. It cannot corrupt
  any other module; deleting it leaves zero residue.
- **Zero migrations.** Permission keys live in the `client_levels.permissions` JSONB,
  not in schema. Adding rollup tables is a future option only if a real tenant's data
  volume proves it necessary.
- **Charting:** Recharts (declarative React/SVG, tree-shakeable). Chart-lib types are
  confined to three wrapper components, so swapping libraries later is local.

## 3. Module structure

```
src/modules/analytics/
  registry/
    domains.ts                 # add a domain = add a manifest + a line
    types.ts                   # AnalyticsDomain manifest type
    manifests/
      sales.ts bookings.ts customers.ts team.ts catalog.ts
  components/
    AnalyticsDashboard.tsx     # page: filter bar + domain panels
    KpiTile.tsx                # value, Δ vs prior, sparkline
    TrendChart.tsx BarChart.tsx DonutChart.tsx   # Recharts wrappers
    DomainPanel.tsx            # renders a domain's tiles + charts from its manifest
    FilterBar.tsx ScopePicker.tsx DateRangePicker.tsx ExportButton.tsx
  hooks/ useAnalytics.ts useScope.ts
  api.ts                       # typed client for analytics-* endpoints

netlify/functions/
  _analytics-authz.ts          # requirePermission + scope resolution (shared guard)
  _analytics-scope.ts          # subtree node-set + isRootScope resolver
  _analytics-sql.ts            # GROUP BY builders, tz day/week/month bucketing, compareWindow
  analytics-overview.ts        # headline scorecard across permitted domains
  analytics-sales.ts analytics-bookings.ts analytics-customers.ts
  analytics-team.ts analytics-catalog.ts
```

Per-domain functions (not one `?domain=` mega-function) to avoid the three documented
Netlify routing traps (function-name-routing, subdir-function-discovery,
config-path-method): one `config.path` each, independently testable. `_analytics-*`
helpers use the underscore-prefix convention so Netlify treats them as non-routed
helpers (matches `_pos-*` / `_booking-*` / `_pub-*`).

## 4. Pluggable domain manifest

```ts
interface AnalyticsDomain {
  key: 'sales' | 'bookings' | 'customers' | 'team' | 'catalog';
  label: string;
  bucket: DataBucket;            // gates visibility: analytics.<bucket>.view
  kpis: KpiSpec[];               // { id, label, fmt, sqlBuilder }
  series: SeriesSpec[];          // { id, chart:'line'|'bar'|'donut', sqlBuilder }
  breakdowns: BreakdownSpec[];   // drill-down dimensions (channel/category/staff/...)
  scopeColumn: string | null;    // node column to subtree-filter on, or null
}
```

| Domain | bucket | KPIs / series (representative) | scopeColumn |
|---|---|---|---|
| Sales | `business` | revenue, # sales, AOV, paid→fulfilled funnel; revenue-by-day; by channel/category/staff | `created_by_user_node` |
| Bookings | `business` | bookings, utilisation %, cancel/no-show rate, deposit-vs-pay-at-venue, lead time; bookings-by-day; by service | `user_node_id` (assigned staff) |
| Customers | `customers` | new-vs-returning, repeat rate, top customers by spend (keyed on phone — identity is fuzzy, no `customer_id` FK) | derived from sales/bookings scope |
| Team | `employees` | active users, actions/day (`audit_log`), sales-per-staff | actor node |
| Catalog | `products` | catalog size, discounted mix, top/bottom sellers, visibility split | `null` (tenant-wide) |

## 5. Data scoping mechanics

One shared resolver (`_analytics-scope.ts`) so scoping lives in exactly one place:

1. From JWT: viewer's `user_node` + granted permission keys.
2. Compute **`scopeNodes`** = viewer node + all descendants (recursive CTE over
   `user_nodes`, same walk AMS uses).
3. Compute **`isRootScope`** = does `scopeNodes` include the org root?
4. Each domain query appends `WHERE <scopeColumn> = ANY(:scopeNodes)`, except:
   - **Storefront sales** (`source='storefront'`, `created_by_user_node IS NULL`):
     node-less, so included **only if `isRootScope`** → "house revenue, owner-scope
     only". Sub-manager sales queries never union in storefront rows.
   - **Catalog** (`scopeColumn: null`): not subtree-filtered; gated purely by
     `analytics.products.view`.

```sql
-- scoped POS sales aggregate
SELECT date_trunc('day', created_at AT TIME ZONE :tenant_tz) AS day,
       count(*) AS sales, sum(total_cents) AS revenue_cents
FROM sales
WHERE bucket_id = :tenant
  AND created_at >= :from AND created_at < :to
  AND source = 'pos'
  AND created_by_user_node = ANY(:scopeNodes)
GROUP BY 1 ORDER BY 1;
-- storefront branch added ONLY when :isRootScope
```

**Invariants:**
- Day/week/month bucketing always uses `AT TIME ZONE :tenant_tz` (reuses xlsx-tz
  logic) — a UTC timestamp bucketed in the wrong tz shifts late-night sales into the
  wrong day.
- Storefront gated on `isRootScope` (not on the node filter) keeps per-manager
  dashboards **additive**: sum every manager's subtree = total attributed sales; owner
  view adds house channel on top. No double-counting.

## 6. Permission model

Pure `bucket × verb`, validates/renders in the access-level dashboard with no
validator changes:

| Key | Unlocks | Verb |
|---|---|---|
| `analytics.business.view` | Sales + Bookings panels | view |
| `analytics.customers.view` | Customers panel | view |
| `analytics.employees.view` | Team panel | view |
| `analytics.products.view` | Catalog panel | view |

- Read-only: manifest declares `verbs: ['view']`; create/edit/delete are meaningless.
- One new `analyticsManifest` + one line in `moduleRegistry`.
- Dashboard self-assembles: `analytics-overview` returns only panels the viewer's
  granted buckets permit. Zero keys → no Analytics nav entry (same gating as
  `PosRouteMounts`/sidebar).
- Server-enforced: each `analytics-*` function calls
  `requirePermission('analytics.<bucket>.view')` before any query — FE gate is
  convenience, the function is the boundary.

Sales and Bookings both map to `analytics.business.view` (not invented
`analytics.sales.*`) to stay inside the validated key space — action-namespaced keys
do not render in the access-level UI.

## 7. Backend endpoint contract

```
GET /api/analytics-<domain>?from=ISO&to=ISO&compare=prior_period|prior_year|none&granularity=day|week|month
→ 200 {
    scope: { nodeCount, isRootScope, label },
    kpis:  [ { id, label, value, unit, delta, deltaPct } … ],
    series:[ { id, chart, points:[{x,y}], comparePoints? } … ],
    breakdowns: [ { id, label, rows:[{ key, value, pct }] } … ],
    generatedAt
  }
```

- `_analytics-authz.ts`: `requirePermission` + scope resolution; reused by all five.
- `_analytics-sql.ts`: tz bucketer, `= ANY(:scopeNodes)` clause, `compareWindow(from,to,mode)`
  returning the prior range so KPI deltas and ghosted comparison series share one query shape.
- Aggregation is **parameterised**, never string-concatenated — no injection surface,
  queries stay index-aligned.
- `analytics-overview.ts`: one KPI per permitted domain in a single request.

## 8. Frontend

```
[ FilterBar: ScopePicker ▾ | DateRange ▾ (Today·7d·30d·Month·YTD·Custom) | Compare ▾ | Export ]
[ Overview scorecard: Revenue · Sales · Bookings · Active staff · … ]
[ DomainPanel: Sales ]      tiles + revenue-by-day line + channel/category bar
[ DomainPanel: Bookings ]   utilisation + cancel-rate tiles + bookings-by-day + by-service donut
[ DomainPanel: Customers ]  new-vs-returning + repeat-rate + top-customers table
[ DomainPanel: Team ]       active-users + actions/day + sales-per-staff bar
[ DomainPanel: Catalog ]    catalog size + discounted mix + top/bottom sellers
```

- Panels self-assemble from domain manifests; adding a KPI is a manifest edit.
- **Drill-down**: clicking a KPI/bar opens a detail drawer backed by existing list
  endpoints (`pos-sales-list`, `booking-list`) with the same scope+date filters →
  summary reconciles to underlying rows, no new detail plumbing.
- Recharts wrappers are the only place chart-lib types leak.
- `ScopePicker` lists only nodes within the viewer's own subtree (scope down, never
  up); defaults to the full subtree.

## 9. Export

- Per-panel Export → XLSX + CSV, reusing `xlsx-tz` (correct tenant-tz date columns) and
  `workspace-export` infrastructure. Contains aggregated rows currently shown
  (scope + date + compare honored) plus a raw-rows sheet for drill-down data.
- **Scheduled/emailed reports excluded** — platform deliberately avoids email infra
  (Booking shipped `.ics` + copy-links to avoid it). On-demand export is the SMB
  workhorse.

## 10. Testing

TDD; respects shared persistent dev DB (no per-test teardown).

- **Unit**: `_analytics-sql` builders, `compareWindow` math, tz bucketing edge cases
  (late-night sale → correct tenant day), delta/percent formatting.
- **Scope/authz integration** (load-bearing): sub-manager sees only subtree rows;
  storefront appears only at root scope; missing permission → 403 and panel absent;
  per-manager subtrees sum to attributed total (additivity invariant).
- Seeded data uses distinct time ranges + randomised unique literals so re-runs don't
  collide on the shared dev DB.
- Full suite green before any handoff.

## 11. Deliberately out of scope

| Excluded | Why |
|---|---|
| Finance / P&L / margins | No cost or GL data in schema — would fabricate numbers |
| Inventory turnover / stock | No stock-level tracking exists |
| Forecasting / ML / anomaly alerts | Premature for data volume; not SMB-essential |
| Scheduled email reports | Platform deliberately has no email infra |

## 12. Build sequence (each lands green before the next)

1. Framework: manifest types, `_analytics-scope`, `_analytics-sql`, authz guard,
   `analytics-overview`, dashboard shell + FilterBar + Recharts wrappers, permission
   manifest + registry line + access-level UI surface.
2. Sales domain (richest dataset; proves the framework end-to-end incl. storefront
   root-scope rule + export).
3. Bookings domain.
4. Customers domain.
5. Team domain.
6. Catalog domain.

## 13. Implementation notes / gotchas

- **No migration needed** — confirm permission keys seed correctly into existing
  `client_levels.permissions` JSONB without schema change.
- Multi-worktree `netlify dev` collides on vite 5173 — pass both `--port` and
  `--target-port` when running this worktree alongside the sibling chat.
- TS implementers must run `npm run typecheck` (runtime/tsx checks don't validate TS).
- Run the **full** suite before declaring green (shared dev DB).
- No `git push` / no merge to `main` from this chat.

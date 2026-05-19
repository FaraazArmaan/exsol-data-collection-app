# ADR 0004: Product Schema, Stock Ledger, and Export Pipeline

- **Status:** Accepted
- **Date:** 2026-05-19

## Context

The brief asked for "ALL FIELDS" from a wide range of marketplaces, stock management with multiple update sources, and exports tailored to specific platforms. The user later clarified that the Data Collection App is the *hub* in a hub-and-spoke architecture: it feeds a future Internal Website (ERP), which in turn feeds consumer-facing apps (booking, catalog, ecom). External marketplace integrations are not a v1 concern.

## Decisions

### Product schema — Core + Overlay
- One canonical `products` table with the fields every product has (sku, name, price, stock_count, dimensions, images, category, tags, status, GST/HSN for India, etc.).
- One row per Product. `product_type` enum: `physical_goods` | `food_item`.
- Marketplace-specific fields live in a separate `product_marketplace_fields` table: `(product_id, marketplace, fields jsonb, enabled, last_synced)`. One overlay row per (product, marketplace) pair.
- v1 marketplaces: `amazon`, `flipkart`, `meta`, `wa`, `rakuten`, `aliexpress`, `swiggy`, `zomato`. Adding more is a code change, not a schema migration.
- Food items get conditional UI fields (prep_time, modifiers, dietary_tags, spice_level) stored within the core table behind the `product_type` switch where they're stable, else in the relevant overlay.

### Stock — ledger of movements, not a number
- `stock_movements (product_id, delta, reason, source, external_ref, actor_id, occurred_at)` is the source of truth.
- `products.stock_count` is materialized from `SUM(delta)` via trigger on insert.
- Every change is a peer movement; no overwrites, no race conditions, full audit trail.
- v1 sources: `manual`, `csv`, `recount`. v2 adds `webhook_<system>`.
- Reasons: `purchase` | `sale` | `damage` | `recount` | `manual_adjust` | future `sale_ecom`, `sale_wa`, etc.

### Export pipeline
- v1 export targets:
  1. **XLSX (comprehensive)** — every core field + every enabled overlay's fields flattened. Consumed by the future Internal Website.
  2. **CSV (comprehensive)** — same content as above.
  3. **Meta Catalog CSV** — Meta's exact schema; works for both Meta Commerce and WhatsApp Business Catalog. Only products with the relevant overlay enabled are included.
- v2 export targets: Amazon flat-file feed; per-Client custom schemas.
- Delivery: **hybrid sync/async**. Backend estimates output size; ≤ 500 products or ≤ 2 MB → sync (instant download). Larger → async job, file uploaded to `<Workspace>/Exports/` in GDrive, in-app toast notifies on completion. Past exports listed in an "Exports" tab.
- Filters at generation time: all, by category, by marketplace-enabled flag, by date range, by selection (multi-select from the products table).
- Async runner: Netlify Scheduled Function polling an `export_jobs` table every minute. Free tier; upgrade to Background Functions later if needed.

### What v1 does NOT include
- Live integrations with WhatsApp Business, Meta, Shopify, WooCommerce, etc.
- Outbound push of stock availability to any external platform.
- Marketing automation (Canva ad generation, scheduled WA blasts for low/dead stock).
- Amazon flat-file export.
- Internal Website read API (designed but not exposed; the consumer doesn't exist yet).

## Consequences

- Stock cardinality stays low in v1 (no high-frequency webhook traffic). `stock_movements` will grow ~1 row per legitimate change, easily handled by Neon free tier.
- Low/Dead/Fast Stock views are pure SQL queries against `stock_movements`, joined with `products`. No ML, no Python.
- The Core + Overlay schema lets you add a marketplace in v2 with code changes only, no migration. Same for stock sources.
- Comprehensive XLSX with 8 overlays will exceed sync threshold for any non-trivial catalog. Async path is critical; do not skip building it.
- The future Internal Website can read from ExSol via three eventual paths: scheduled XLSX export, polling REST API, or push webhook. Schema is shape-agnostic to all three.

## Alternatives considered

- **Mega-table with hundreds of columns** — rejected; unmaintainable.
- **EAV pattern** — rejected; query cost and lost type safety.
- **`products.stock_count` as the source of truth (not ledger)** — rejected; loses audit trail, races on concurrent updates from CSV import + manual edits.
- **Live marketplace integrations in v1** — explicitly deferred by the user; consumer sites are two hops away in the planned topology.

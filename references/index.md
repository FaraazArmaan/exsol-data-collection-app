# References

Curated external resources informing the design and implementation of ExSol Data Collection. Each entry has a one-line note on why it's relevant.

This is a living index — add new entries as new patterns or libraries enter the codebase.

---

## UI / UX design

- **[Refactoring UI by Adam Wathan & Steve Schoger](https://www.refactoringui.com/)** — Practical guidance on spacing, hierarchy, color, and typography for developer-built UIs. Source of the visual system used in `public/assets/css/base.css`.
- **[Material Design — Data Tables](https://m3.material.io/components/data-tables/overview)** — Conventions for sortable, filterable product tables with row hover and action affordances.
- **[Shopify Polaris](https://polaris.shopify.com/)** — Reference for e-commerce admin UI patterns (bulk actions, product cards, inventory dashboards).
- **[Linear's app](https://linear.app/)** — Reference for keyboard-driven, dense, professional SaaS UI; influences the impersonation banner and inline action patterns.
- **[Designing for Touch — Josh Clark](https://abookapart.com/products/designing-for-touch)** — Touch-target sizing and gesture patterns informing the responsive product table on mobile.

## Authentication & sessions

- **[Google Identity Services overview](https://developers.google.com/identity/gsi/web/guides/overview)** — Official guide for the "Sign in with Google" button used on `/login.html`.
- **[RFC 8725 — JSON Web Token Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725)** — Hardening guidance applied to the JWT implementation in `src/lib/session-manager.ts`.
- **[OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)** — Checklist used to validate auth flow (rate limiting, lockout, password storage, session rotation).
- **[Argon2 — RFC 9106](https://datatracker.ietf.org/doc/rfc9106/)** — Algorithm spec for the password hashing used by the email/password fallback.

## Multi-tenancy & data isolation

- **[Postgres Row-Level Security (RLS)](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)** — The mechanism enforcing tenant isolation across every workspace-scoped table.
- **["Multi-tenant SaaS architecture on Postgres" — Crunchy Data](https://www.crunchydata.com/blog/postgres-multi-tenant-rls)** — Real-world patterns for `current_setting()` + `SECURITY DEFINER` helpers used in migrations 003 and 008.
- **["Designing for Multi-tenancy" — Microsoft Patterns & Practices](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/overview)** — Trade-offs between shared-DB, schema-per-tenant, and DB-per-tenant. Informs ADR 0003.

## Marketplace catalogs (export targets)

- **[Meta Commerce — Catalog Feed CSV Spec](https://developers.facebook.com/docs/marketing-api/catalog/reference/)** — Exact column names + values for the Meta Catalog export (works for both Meta Commerce and WhatsApp Business).
- **[WhatsApp Business Catalog API](https://developers.facebook.com/docs/whatsapp/business-management-api/catalog/)** — Programmatic catalog management (deferred to v2; export-only in v1).
- **[Amazon Selling Partner API — Listings](https://developer-docs.amazon.com/sp-api/docs/listings-items-api-v2021-08-01-reference)** — Reference for the eventual Amazon flat-file feed (deferred to v2).
- **[Flipkart Marketplace Seller API](https://seller.flipkart.com/api-docs/FMSAPI.html)** — Reference for Flipkart listing schema (deferred to v2).

## Infrastructure & runtimes

- **[Netlify Functions documentation](https://docs.netlify.com/functions/overview/)** — Function format, config, deploy contexts, env vars, image CDN.
- **[Netlify Image CDN](https://docs.netlify.com/image-cdn/overview/)** — Used (in Phase 5) to serve product images via `/.netlify/images?url=...`.
- **[Neon serverless driver](https://github.com/neondatabase/serverless)** — `@neondatabase/serverless` Pool implementation + WebSocket configuration notes.
- **[Node.js native env-file support](https://nodejs.org/api/cli.html#--env-fileconfig)** — `--env-file` flag used in `npm run migrate` and `bootstrap:admin` scripts.

## Library documentation

- **[exceljs](https://github.com/exceljs/exceljs)** — Used in Phase 5 for XLSX exports.
- **[papaparse](https://www.papaparse.com/docs)** — CSV parsing + generation for imports and exports.
- **[jszip](https://stuk.github.io/jszip/documentation/api_jszip.html)** — Workspace backup ZIP composition.
- **[jose](https://github.com/panva/jose)** — JWT signing and verification (HS256).
- **[@node-rs/argon2](https://github.com/napi-rs/node-rs/tree/main/packages/argon2)** — Native-binding Argon2id implementation for password hashing.
- **[Vitest](https://vitest.dev/)** — Test framework; the DB-gated tests use its `it.skip` pattern.

## Patterns referenced in code

- **["Deep Modules" — John Ousterhout, *A Philosophy of Software Design*](https://web.stanford.edu/~ouster/cgi-bin/aposd.php)** — The thinking behind keeping module interfaces small while the bodies hide complexity. Used to shape the 13 deep modules described in `docs/prd-v1.md`.
- **["Stock as a ledger" — Event sourcing patterns](https://martinfowler.com/eaaDev/EventSourcing.html)** — Applied to `stock_movements` and the derived `products.stock_count` trigger; documented in ADR 0004.
- **[Postgres `SECURITY DEFINER` functions](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)** — Mechanism used in migration 008's `is_member_of()` helper to bypass RLS recursion safely.
- **[Matt Pocock — Type-safe enums and exhaustive switches](https://www.totaltypescript.com/)** — Pattern reference for the `Action` discriminated union in `src/lib/types.ts`.

## Indian context: GST, HSN, regional considerations

- **[GST HSN code lookup — GSTN](https://services.gst.gov.in/services/searchhsnsac)** — Official HSN code reference for product GST classification.
- **[India default currency (INR) and timezone (Asia/Kolkata)](https://www.iana.org/time-zones)** — Locale defaults applied to new workspaces.

---

## How to add to this index

Append entries under the most relevant section. Each entry: bolded title with link, em-dash, one or two sentences explaining what the reference is and why it's relevant to this project. Avoid linking to material we haven't actually consulted — this is a curated list, not a bibliography.

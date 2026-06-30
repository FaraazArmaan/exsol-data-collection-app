# Booking v1 — Pay-at-Venue (no external services) Plan

> Makes the already-built booking module a fully usable product with **zero external dependencies** (no Razorpay, no email provider). `pay_at_venue` already works end-to-end; this closes the 3 real gaps. Same branch `feat/booking-module-iso`, TDD, local commits only.

## Why
- Email is greenfield (no mailer) and Razorpay is deploy-gated — both are external-service projects. `payment_mode` is per-service and `manage_token` is a self-contained capability URL, so a no-external-services v1 falls out cleanly.

## Status: T1–T3 DONE (2026-06-30) · T4 env-blocked
Build green; full booking suite **88 tests** (25 files). T1 verified live through the `netlify dev` proxy (create → a `customers`-bucket role auto-exists). T4 visual browser smoke still blocked by the cross-session playwright profile lock — data layer, ics, and live create flow proven instead.

## Tasks

- [ ] **T1 — Lazy-seed the customers-bucket role (backend).** Today `upsertCustomer` throws `no_customer_role` when a tenant has no `client_roles` row with `bucket_family='customers'`, breaking guest checkout. Change it to **create a default `Customer` role on demand** (key `customer`, label `Customer`, `bucket_family='customers'`) when none exists, then attach the node. Self-healing for every existing tenant; no admin/onboarding endpoint changes (those are out of this chat's scope). Update `customer-upsert.test.ts`: the "no role" case now asserts auto-create (node gets a customers-bucket role), not a throw. Guard against a concurrent double-create (catch unique violation, re-select).

- [ ] **T2 — Self-service manage link + .ics on Confirmation (FE, no email).** The manage flow needs the customer to keep their `manage_token` URL; email is the missing channel. On `public/Confirmation.tsx`: show the full manage URL with a **Copy link** button (`navigator.clipboard`) and an **Add to calendar (.ics)** download generated client-side. New `src/modules/booking/ics.ts` — `buildIcs({uid,title,startIso,endIso})` → RFC-5545 string (UTC `YYYYMMDDTHHMMSSZ`), plus a `downloadIcs(filename, content)` helper. Unit-test `buildIcs` (deterministic). Wire both buttons into Confirmation.

- [ ] **T3 — Gate online-payment service modes (FE).** Until Razorpay is live, vendors must not create `deposit`/`full_upfront` services (their checkout dead-ends at the stub). New `src/modules/booking/config.ts` → `export const ONLINE_PAYMENTS_ENABLED = false;`. In `vendor/ServicesPage.tsx`, when false, the payment-mode `<select>` offers only `pay_at_venue` and shows a muted note "Online payment (deposit/upfront) needs payment setup — coming soon." Flip the flag to `true` when Razorpay ships (single-line change). Backend keeps accepting all modes (ready for Razorpay); the gate is FE-only and the storefront already shows a graceful "payment not enabled yet" placeholder as a backstop.

- [ ] **T4 — Browser visual smoke.** With an isolated browser + the seeded `smoke-booking` tenant, walk the storefront visually: service list renders → pick slot → checkout → confirmation shows the copy-link + .ics. Screenshot. (Deferred from Phase 3b due to the cross-session browser lock; do it here if a browser is free.)

## Out of scope (separate external-integration tracks)
- Razorpay live order-create + Checkout JS (enables deposit/full_upfront).
- Email provider + confirmation/reminder templates (drops the self-service-link workaround).
- Tier-2 polish: holiday/date-override editor, service-edit drawer, resource weekly-schedule editor, pixel time-grid.

## Verification
Each task ends TDD-green (T1 unit/integration, T2 unit) + `npm run build` green (T2/T3 FE). T4 is a visual browser pass.

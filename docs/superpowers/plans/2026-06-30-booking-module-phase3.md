# Booking Module — Phase 3 Plan (Ops, Payments, Manage, Cron, UI)

> Continues build-order E–J. Split by testability: **3a backend** (TDD-green now, no external deps) then **3b UI** (React, needs FE patterns + manual verify). Razorpay's live API + UI are the only externally-gated pieces.

## Decisions baked in
- **Perms:** `booking.customers.view` (read/calendar), `booking.customers.edit` (transitions), `booking.customers.create` (manual-create). Vendor endpoints gate via `requireBooking`.
- **FSM:** reuse Phase-1 `src/modules/booking/lib/fsm.ts applyTransition`. `complete`/`noShow` guard passes `startsAt = slotStart + duration` so "now > start+duration" holds. `cancelCutoffMin` from settings; vendor cancel bypasses cutoff (`byVendor: true`).
- **Magic-link manage:** anonymous, keyed by `bookings.manage_token` (unique); the token alone resolves the booking + its bucket — no slug needed.
- **Razorpay:** webhook signature = HMAC-SHA256(`order_id|payment_id`, KEY_SECRET) — verifiable offline (testable). The order-create call needs `RAZORPAY_KEY_ID/SECRET` + network → guarded; unit-test the signature + the pending→confirmed flip, not the live API. Env vars added to all Netlify contexts (deploy-checklist).
- **Cron:** Netlify scheduled function via in-file `export const config = { schedule: '*/5 * * * *' }` (scheduled functions are greenfield here — verify the schedule syntax on first deploy).

## Phase 3a — backend ✅ COMPLETE (2026-06-30)
All tasks below implemented TDD-green. **Full booking suite: 24 files, 86 tests pass; typecheck clean.** Razorpay order-create (live API) + netlify.toml schedule registration are the only deploy-time-verified pieces; everything else proven against the real DB.
- [ ] **E1 `booking-list.ts`** GET `/api/booking/list?from=&to=&status=&resource_id=` — vendor calendar/list; `booking.customers.view`; bucket-scoped, date+status+resource filters. Mirror `pos-sales-list`.
- [ ] **E2 `booking-detail.ts`** GET/PATCH `/api/booking/detail/:id` — GET one (404 cross-tenant); PATCH `{action}` runs `applyTransition` (map `missing_perm`→403, `illegal_transition`→409, `too_late_to_cancel`/`too_early`→409) then updates `status`/`cancelled_at`/`cancellation_reason`. `booking.customers.view`/`edit`.
- [ ] **E3 `booking-manual-create.ts`** POST `/api/booking/manual-create` — vendor create; `booking.customers.create`; reuses `upsertCustomer`; bypasses lead-time + cutoff; supports `status:'blocked'` (no customer/service) for staff time; `23P01`→409. Off-grid start allowed (gist still guards).
- [ ] **F `booking-public-manage.ts`** GET/POST `/api/booking-public/manage/:token` — anonymous; GET returns booking + cutoff countdown by `manage_token`; POST `{action:'cancel'}` cancels iff `now < starts_at - cancel_cutoff_min`, else 409 `too_late_to_cancel`.
- [ ] **H `booking-pending-cleanup.ts`** scheduled — flips `pending` bookings older than 15 min (no payment) → `cancelled`, freeing the slot. Unit-test the selection/flip query against seeded rows.
- [ ] **E-pay `_booking-razorpay.ts` + `booking-razorpay-webhook.ts`** — `verifyWebhookSignature(orderId, paymentId, signature, secret)` (HMAC-SHA256, offline-testable); webhook flips the matching `pending`→`confirmed`, records `deposit_paid_cents`. Replace the create-handler `payment_intent` stub with a real order (guarded on env). Live order-create deferred to deploy.
- [ ] **J round-trip smoke** — settings→resource→service→availability→public create→vendor confirm in list→mark completed, one walk.

## Phase 3b — React UI
### Public storefront ✅ DONE (2026-06-30)
`src/modules/booking/api.ts` (public wrappers), `format.ts`, `public/{BookingStorefront,ServicePicker,SlotPicker,Checkout,Confirmation,ManageBooking}.tsx`; routes `/c/:slug/book` + `/c/:slug/book/manage/:token` added OUTSIDE the auth gate (siblings of `login`); booking CSS appended to `components.css`. House style (plain CSS, throwing api wrappers, native Date/Intl). **Verified: `tsc && vite build` green; full public flow smoked end-to-end through live `netlify dev` proxy (services→availability→create→manage→cancel).** pay_at_venue works fully; Razorpay Checkout step shows a "pending" placeholder (live order-create is deploy-gated). Browser visual smoke deferred (cross-session playwright profile lock + multi-worktree vite-port collision; data layer + build proven instead).

### Vendor UI — NOT started (next)
Public storefront pages (ServicePicker, SlotPicker, Checkout + Razorpay Checkout JS, Confirmation, ManageBooking) under `src/modules/booking/public/`; vendor pages (CalendarPage day-view, BookingsListPage, ServicesPage, ResourcesPage, SettingsPage, manual/blocked drawers) under `src/modules/booking/vendor/`; route mounts (`BookingRouteMounts.tsx` mirroring `PosRouteMounts`), `src/lib/router.tsx` entries, sidebar nav (`useNavItems` `MODULES_WITH_DEDICATED_NAV`). Verify with the `run`/browser skill, not just unit tests.

## Status
Executing 3a now. 3b after, with an FE exploration pass first.

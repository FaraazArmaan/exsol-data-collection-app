# Marketing DEPTH — handoff (COMPLETE)

**Branch:** `feat/marketing-depth-iso` in worktree `ExSol-Booking-WT` (off `main` @ 00179bd, cleanup included).
**HEAD:** `8538ea1`. **Migrations used:** 131–136 (all applied on DEV; run on PROD before promoting).
**NEVER push** — hand off for the Main integration chat. **All 6 features done.**

**Done gate (green):** `npm run typecheck` ✓ · full `npm test` = **1385/1385 across 243 files** ✓ · `npm run build` ✓.

> This worktree was previously on `feat/crm-iso` (that branch's commits are intact on its ref). It was
> also stale on node_modules — `npm install` was required (added `@anthropic-ai/sdk`, `pdf-lib` for the
> ai/pdf seams). If you resume and typecheck errors on those modules, run `npm install` first.

## Key platform correction (bit the original plan)
`DATA_BUCKETS` is a **closed 4-value union** (`products|business|employees|customers`). A module CANNOT
mint its own bucket. So every marketing surface — ROI, A/B, GDPR, webhooks, social — maps to
`marketing.customers.{view,create,edit,delete}`. Verb choice encodes intent: read/analytics → `view`,
author → `create`/`edit`, erase → `delete`.

## Feature status
- [x] **ROI Dashboard** — `b5fb707`, mig 131. Email-match attribution (sales+bookings) within per-campaign
      window (default 14d). `/api/marketing/roi` (customers.view). 4 tests. **Follow-up:** client.base_currency
      not on FE auth context → money renders in default INR; wire it when the FE exposes currency.
- [x] **Omnichannel Send** — `a6e0968`, mig 132. Channel on campaigns; pure dispatch seam
      (`lib/channels.ts`, deliver injected); email live, sms/whatsapp mock (logged). Per-channel
      contact resolution. Compose channel selector. 7 tests. **Note:** audience-count endpoint still
      email-only; channel-aware count is a possible follow-up.
- [x] **A/B Testing** — `b4146f8`, mig 133. Two subjects, FNV-hash split, open pixel + click
      redirect (PUBLIC `/api/marketing/track/:kind`), variant compare (`/campaigns/:id/ab`), winner
      highlight. 8 tests. **Follow-ups:** click-tracking needs auto link-rewriting (endpoint ready,
      not wired); public track endpoint unauth + unrate-limited.
- [x] **Webhook Listener** — `1ad0ed3`, mig 134. Per-tenant endpoints (token+secret), signed
      receiver (`/api/marketing/webhook/:token`), triggers → 1:1 send. WebhooksPage + nav. 4 tests.
      **Follow-up:** receiver unrate-limited.
- [x] **GDPR Toolbox** — `328c01d`, mig 135. Export bundle across crm/sales/bookings/sends/consent;
      erase anonymizes (sales kept + PII stripped to `[erased]`; others nulled); consent log; erasure
      audit log. GdprPage with two-step erase confirm. 4 tests.
- [x] **Social Scheduler** — `8538ea1`, mig 136. Compose/schedule to mock provider seam
      (`lib/social.ts`, per-provider char limits); `dispatchDue` cron sweep (`*/5`) + post-now/cancel.
      SocialSchedulerPage. 9 tests. **Note:** scheduled functions greenfield — verify cron registers on deploy.

Docs commits (`docs(marketing)`) between features are living-handoff updates, not features.

## PROD promotion (additive — code depends on new columns/tables)
Run `npm run migrate` against the PROD `DATABASE_URL` for 131–136 **before** promoting this code
(additive order: schema first). All are `if not exists` / `add column if not exists` guarded.

## Routing to probe post-deploy (integration tests bypass Netlify routing — iron rule 5)
`/api/marketing/roi`, `/api/marketing/campaigns/:id/ab`, `/api/marketing/track/:kind` (public),
`/api/marketing/webhook/:token` (public), `/api/marketing/webhooks`, `/api/marketing/webhook-triggers`,
`/api/marketing/gdpr/{export,erase,consent}`, `/api/marketing/social-posts`,
`/api/marketing/social-dispatch` (cron). Functions serving multiple methods from ONE file (no
config.method): `webhooks`, `webhook-triggers`, `gdpr/consent`, `social-posts` — verify each method routes.

## Not done / follow-ups for integration
- `npm run docs:reference` NOT regenerated (endpoints/permissions/schema.md) — run on integration; note the
  known schema.md generator regex debt.
- New env vars (all optional; features degrade gracefully without them): `PUBLIC_BASE_URL` (absolute pixel/
  webhook URLs — falls back to relative), `MAIL_FROM`, `RESEND_API_KEY` (email actually delivered vs logged).
- Public endpoints (`track/:kind`, `webhook/:token`) are unauthenticated beyond HMAC and **unrate-limited**.
- SMS/WhatsApp/social are **mock seams** (log/simulate) — swap the one seam function per provider when keys land.

## Inherited deferred item (from v1, still open)
Campaign `body_html` renders via `dangerouslySetInnerHTML` → stored XSS bounded to trusted staff.
Sanitize (DOMPurify) before live Resend / broadening authorship. Not addressed in depth.

## Verification gate per feature
`npm run typecheck` + `npx vitest run tests/marketing` green after each commit; FULL suite before handoff.

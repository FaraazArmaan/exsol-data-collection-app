# Handoff — Marketing Automation v1 (2026-07-04)

## ═══════ STATUS: COMPLETE — ready for integration cherry-pick ═══════

Marketing Automation v1 is **built, fully tested, and green** on branch `feat/marketing-iso` in
worktree `../ExSol-Marketing-WT`. **Local commits only — never pushed.** Cherry-pick onto `main`.

- **HEAD:** `740b16e`  |  **merge-base with main:** `a6ab94e`  |  **17 commits**
- **Done gate (all green):** `tsc --noEmit` 0 errors · **vitest 1292/1292** (222 files) · `vite build` ✓.
- Every task implemented TDD + reviewed (spec + quality) by a separate agent; 2 review-driven fixes
  (partial-send guard; seed emailable-demo customers).

## What it is

Email **campaigns over CRM + the mailer**. A vendor composes a campaign (subject + HTML body), previews
the emailable audience count live, sends now, and sees a per-recipient send log. A thin **orchestration**
layer: it READS `crm_customers` (audience) and CALLS the mail transport `deliver()` — it does not
re-implement sending and does not write `crm_customers` (except the seed's demo rows).

**Spec/plan:** `docs/superpowers/specs/2026-07-04-marketing-automation-design.md`,
`docs/superpowers/plans/2026-07-04-marketing-automation.md`.

## Dependencies (both already on `main`)

- **CRM (055)** — `crm_customers` (audience source). `campaign_sends.customer_id` FKs it → **055 must
  precede 060** (true on main). 
- **Email (052)** — the low-level transport `deliver()` in `netlify/functions/_shared/resend.ts`.

## Migration

- **`db/migrations/060_marketing.sql`** — `marketing_campaigns` + `campaign_sends`.
- 060 was FREE on main (main has 058/059/061/062; 060 is the reserved gap). **Prod:** run
  `npm run migrate` against the prod DATABASE_URL to apply 060 BEFORE deploying marketing code.

## New Netlify functions (flat files) + routes

| File | Route | Method | Perm |
|---|---|---|---|
| `marketing-campaigns-list.ts` | `/api/marketing/campaigns` | GET | `marketing.customers.view` |
| `marketing-campaign-create.ts` | `/api/marketing/campaigns` | POST | `marketing.customers.create` |
| `marketing-campaign-detail.ts` | `/api/marketing/campaigns/:id` | GET | `marketing.customers.view` |
| `marketing-audience-count.ts` | `/api/marketing/audience-count?audience=` | GET | `marketing.customers.view` |
| `marketing-campaign-send.ts` | `/api/marketing/send` (`{campaign_id}` body) | POST | `marketing.customers.edit` |
| `_marketing-authz.ts` | (helper) | — | enable-gate + `level_number===1` bypass, mirrors `_crm-authz.ts` |

List + create share `/api/marketing/campaigns` and both set `config.method`. Send is a flat
`/api/marketing/send` (no literal sub-path under a `:param`). Shared logic: `src/modules/marketing/lib/
audience.ts` (`audienceRecipients`/`audienceCount`, reused by the count endpoint AND the send loop). FE
under `src/modules/marketing/` mirrors CRM/Booking. Wired in `router.tsx`, `useNavItems.ts`, `Sidebar.tsx`.

## Registry + enablement

- `marketing` ModuleManifest + `marketing` ProductManifest, registered in `modules.ts`/`products.ts`.
  Perms bucket×verb `marketing.customers.{view,create,edit,delete}`.
- A tenant sees Marketing only if the `marketing` product is in `client_enabled_products`.
  `npm run seed:marketing` enables it for `papa-s-saloon`, seeds 1 draft + 1 sent campaign (3 send-log
  rows) AND 3 emailable demo `crm_customers` so the compose→send demo is non-empty. Enable prod tenants
  via product management.

## Env vars

**None new.** Dev needs nothing (no `RESEND_API_KEY` → `deliver()` dev-fallback records sends as
`logged`, no network). **Live sending** reuses Email's existing `RESEND_API_KEY` + `MAIL_FROM` — when
`RESEND_API_KEY` is present, campaigns actually send via Resend.

## Send model (important)

`POST /api/marketing/send` **atomically claims** the campaign
(`UPDATE marketing_campaigns SET status='sent', sent_at=now() WHERE id=$1 AND client_id=$2 AND
status='draft' RETURNING …`; no row → 404 if absent else 409 `already_sent`). The claim closes BOTH
sequential re-send AND **concurrent** double-send — proven by a `Promise.all` concurrency test: two
simultaneous sends yield exactly one 200 + one 409, and `campaign_sends` = audience size (not doubled).
It then resolves `audienceRecipients` (emailable `crm_customers`; `recent_30d` adds a 30-day `last_seen`
window) and per recipient calls `deliver({to,from,subject,html})` + inserts a `campaign_sends` row, each
wrapped in try/catch so one bad recipient can't abort the batch (status already 'sent' → never re-blastable).

## Gotchas / decisions

- **Audience = emailable only.** `crm_customers.email` is nullable (phone-only POS customers). Both the
  count preview and the send use the SAME `audience.ts`, so the previewed number equals actual reach.
- **Raw `deliver()`, not `sendMail`.** `sendMail` is template-locked to 2 templates (`booking_confirmation`,
  `storefront_receipt`) via a TS union + `email_outbox` CHECK. Campaigns are arbitrary content → the raw
  transport seam. **Zero edits to Email's closed template set.**
- **L1 Owner bypass** present in `_marketing-authz.ts`, `Sidebar.tsx`, `MarketingRouteMounts.tsx`.
- **⚠️ PRE-LIVE HARDENING (do before enabling live Resend for real multi-user tenants):** the compose
  preview + detail render `body_html` via `dangerouslySetInnerHTML`. An L2 staff member with
  `marketing.customers.create` can store `<script>`/`<img onerror=…>` that executes in a viewer's (incl.
  the L1 Owner's) authenticated session — **real stored XSS**, bounded to one tenant's trusted staff.
  Deferred for this trusted-staff width-slice v1 (per whole-branch review); fix by sanitizing the RENDER
  (e.g. DOMPurify) while keeping the raw HTML for the actual email body. This is the ONE substantive
  fast-follow before broadening who can author campaigns / turning on live sending.

## Theming (iron rule #9)

`.mkt-*` CSS consumes `src/lib/theme.css` dark tokens only (`--bg-elevated`, `--text-primary/-secondary/
-muted`, `--border-default/-subtle`) — no invented `--border`/`--muted-bg` tokens, no hardcoded light
values. Verified no hex/invented tokens anywhere in `src/modules/marketing/`. (jsdom doesn't eval CSS
vars, so this can't be caught by tests — confirm in a real browser.)

## Cross-cutting flag for the integration chat

- **CRM's `.crm-*` CSS (already merged to main) likely violates iron rule #9** — it was written before
  that rule and used the same `var(--border, #e5e7eb)` / `--muted-bg` / light-hardcode pattern I just
  fixed in `.mkt-*`. Audit `.crm-*` (and any other pre-rule-#9 module) in `src/lib/components.css` and
  swap to `theme.css` tokens, or it renders white cards / invisible text on the dark platform.

- **Authz `client_id` (defense-in-depth, NOT a regression):** `_marketing-authz.ts` mirrors
  `_crm-authz.ts`/`_email-authz.ts` — the enable-gate uses the JWT `claims.client_id` while `permRows`
  pins by `user_node_id`. Not exploitable (sessions signed). A platform-wide pass could add
  `AND un.client_id = claims.client_id` to the perm query across all `_*-authz.ts` files.

## Deferred Minor findings (none block merge; final-review triaged)

- `marketing-campaign-send.ts` serial fan-out (fine at demo scale; batch if thousands).
- Compose page: audience-count error indistinguishable from loading (stuck on "Counting…"); `nav()` inside
  the save try/catch could show a wrong error if it threw.
- `CampaignDetailPage` `btn btn-primary` (cosmetic vs the brief's `btn`).
- `create` endpoint `as any[]` on the INSERT result; test-helper `ensureBootstrapAdmin` redundant write.

## Verification note

Golden flow (compose → non-zero audience count → send → sends log populates) is proven by
`tests/marketing/*`: audience-count correctness (emailable + 30-day filters), send fan-out (2 of 3 seeded
→ `logged` + status flip + re-send 409), authz (401/412/403/L1). FE is build-verified. A manual browser
(or API) smoke via `netlify dev --port 5193 --target-port 8903` is recommended before prod but was not
run headlessly here.

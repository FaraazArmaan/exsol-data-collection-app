# Marketing Automation v1 — Design Spec (2026-07-04)

Status: **approved for planning**. Isolated build in worktree `../ExSol-Marketing-WT` on branch
`feat/marketing-iso` (off `main`). Local commits only — the Main integration chat cherry-picks. Ports
for `netlify dev`: **5193 / 8903**. Reserved migration number: **060** (free on main; main is at 062).

## 1. Purpose & scope

Email **campaigns over CRM + the mailer**. A vendor composes a campaign, previews its audience count,
sends now, and sees a per-recipient send log. WIDTH SLICE: shallow but real, no dead ends, every state
handled, realistic seeded demo data. It is a thin **orchestration layer** — it *reads* `crm_customers`
(never writes it) and *calls* the existing mail transport (never re-implements sending).

### Dependencies (both present on current `main`)
- **CRM (055)** — `crm_customers` (audience source). `campaign_sends.customer_id` FKs it, so 055 must
  precede 060 (true on main; prod-ordering note for the handoff).
- **Email (052)** — the mailer seam: low-level `deliver()` in `netlify/functions/_shared/resend.ts`.

### In scope
- `marketing_campaigns` + `campaign_sends` (migration 060).
- Audience resolution over `crm_customers` (`all` | `recent_30d`), **emailable-only**.
- Send-now fan-out via `deliver()` (dev-fallback logs when no `RESEND_API_KEY`); per-recipient log.
- Vendor UI: campaign list, compose (textarea + live preview + live audience count), detail with send +
  sends log.
- Registry (ModuleManifest + ProductManifest), `_marketing-authz.ts`, sidebar + route mounts.
- `scripts/seed-marketing.ts` (papa-s-saloon: 1 draft + 1 sent campaign with a few sends).
- Tests + golden-flow smoke.

### Out of scope (v1)
Scheduling/recurring, segmentation beyond all/recent_30d, A/B, open/click tracking, unsubscribe,
rich-text widget, template management. Send is one-way `draft → sent`.

### Golden flow
Compose → preview audience count → send → the sends log shows entries.

## 2. Send seam (chosen: raw `deliver()` + own log)

The high-level `sendMail` (`_shared/mailer.ts`) is **template-driven** with a closed set of two
templates (`booking_confirmation`, `storefront_receipt`), enforced by a TS union AND the
`email_outbox.template` CHECK — it does not accept arbitrary subject/HTML. Campaigns are arbitrary
content, so Marketing uses the **low-level transport** `deliver(mail)` from `_shared/resend.ts`:

```ts
// resend.ts
interface OutgoingMail { to: string; from: string; subject: string; html: string; attachments?: ... }
interface DeliveryResult { ok: boolean; delivered: boolean; providerId?: string; error?: string }
export async function deliver(mail: OutgoingMail): Promise<DeliveryResult>
// dev fallback: no RESEND_API_KEY -> return { ok:true, delivered:false }  (i.e. "logged", no network)
```

This needs **zero changes** to the Email module's closed template set / `email_outbox` CHECK. Marketing
records sends in its OWN `campaign_sends` table (the spec's requested log). Rejected alternatives:
extend the `MailTemplate` union + CHECK (heavier, campaigns aren't templates); a hybrid outbox wrapper
(most cross-module coupling).

## 3. Data model — migration `060_marketing.sql`

```
marketing_campaigns
  id            uuid pk default gen_random_uuid()
  client_id     uuid not null  -> public.clients(id) on delete cascade
  name          text not null
  subject       text not null
  body_html     text not null
  audience      text not null default 'all'   check (audience in ('all','recent_30d'))
  status        text not null default 'draft' check (status in ('draft','sent'))
  sent_at       timestamptz
  created_by_user_node uuid    -> public.user_nodes(id) on delete set null
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null default now()

campaign_sends
  id             uuid pk default gen_random_uuid()
  client_id      uuid not null -> public.clients(id) on delete cascade
  campaign_id    uuid not null -> public.marketing_campaigns(id) on delete cascade
  customer_id    uuid          -> public.crm_customers(id) on delete set null   -- snapshot link
  recipient_email text not null
  status         text not null check (status in ('sent','logged','failed'))
  provider_id    text
  error          text
  created_at     timestamptz not null default now()

indexes: campaign_sends (campaign_id); campaign_sends (client_id, created_at desc);
         marketing_campaigns (client_id, created_at desc)
```

SQL style: one statement per line; comments on their own line, never after a `;`; no `$$`; lowercase
idempotent DDL; CHECKs inline (avoids non-idempotent ALTER). Header comment cites this spec.

## 4. Audience resolution (shared, reused — the DRY seam)

`src/modules/marketing/lib/audience.ts`:
```ts
export type Audience = 'all' | 'recent_30d';
export async function audienceRecipients(sql, clientId, audience): Promise<{ id: string; email: string }[]>
export async function audienceCount(sql, clientId, audience): Promise<number>
```
Both filter **`email is not null`** (email campaigns can only reach emailable customers — `crm_customers.email`
is nullable, many are phone-only from POS). `recent_30d` adds `last_seen >= now() - interval '30 days'`.
Reused by the count-preview endpoint AND the send fan-out, so the previewed number always equals actual
reach. Tenant-scoped by `client_id`.

## 5. Send fan-out (`marketing-campaign-send.ts`)

`POST /api/marketing/send` `{ campaign_id }`, `requireMarketing(['marketing.customers.edit'])`:
1. Load the campaign (tenant-scoped). 404 if absent; **409 `already_sent`** if `status <> 'draft'`.
2. `recipients = audienceRecipients(sql, clientId, campaign.audience)`.
3. For each recipient: `const res = await deliver({ to: email, from: env MAIL_FROM ?? 'notifications@example.com',
   subject: campaign.subject, html: campaign.body_html })`; `status = res.delivered ? 'sent' : res.ok ? 'logged' : 'failed'`;
   insert a `campaign_sends` row (`campaign_id, customer_id, recipient_email, status, provider_id, error`).
4. `update marketing_campaigns set status='sent', sent_at=now()`.
5. Return `{ sent: n, byStatus: { sent, logged, failed } }`.

`deliver` never throws → one bad address can't abort the batch. Sync per-recipient loop (Neon HTTP has no
easy transactions; same consistency class as CRM's refresh loop; demo scale is small).

## 6. Endpoints (flat `netlify/functions/marketing-*.ts`, each `requireMarketing`)

| File | `config.path` | method | required perm |
|---|---|---|---|
| `marketing-campaigns-list.ts` | `/api/marketing/campaigns` | GET | `marketing.customers.view` |
| `marketing-campaign-create.ts` | `/api/marketing/campaigns` | POST | `marketing.customers.create` |
| `marketing-campaign-detail.ts` | `/api/marketing/campaigns/:id` | GET | `marketing.customers.view` |
| `marketing-audience-count.ts` | `/api/marketing/audience-count` | GET | `marketing.customers.view` |
| `marketing-campaign-send.ts` | `/api/marketing/send` | POST | `marketing.customers.edit` |

- List + create **share** `/api/marketing/campaigns` → both MUST set `config.method` (GET/POST)
  (`feedback_netlify_config_path_method`).
- Send uses a flat `/api/marketing/send` (no literal sub-path under a `:param` route —
  `feedback_netlify_routing`). `:id` detail is distinct from the collection path.
- Detail returns `{ campaign, sends }` (sends = `campaign_sends` for that campaign, newest first).
- Create body `{ name, subject, body_html, audience }` → 400 `invalid_input` on missing/empty; returns
  `{ campaign }` as a `draft`.
- Audience-count: `?audience=all|recent_30d` → `{ audience, count }`.

## 7. Registry + authz

- `manifests/marketing.ts`: `{ key:'marketing', label:'Marketing', data_buckets:['customers'],
  verbs:['view','create','edit','delete'], vendor_side:true, customer_side:false }` + register in `modules.ts`.
- `products-list/marketing.ts`: `{ key:'marketing', label:'Marketing Automation',
  modules:[{ module:'marketing', side:'vendor' }] }` + register in `products.ts`. A module with no product
  is invisible (`feedback_module_needs_product_manifest`).
- `_marketing-authz.ts` = clone of `_crm-authz.ts`: enable-gate `modules.has('marketing')` → 412
  `marketing_module_not_enabled`, then **`level_number === 1` Owner bypass** (full perm set), then the
  `required` loop → 403. Same L1 bypass in Sidebar + RouteMount (`feedback_module_l1_bypass_pattern`).
- Perms are bucket×verb only: `marketing.customers.{view,create,edit,delete}`
  (`feedback_permission_keys_bucket_verb_only`). Verb mapping: read=view, create-campaign=create,
  send=edit. The demo tenant gets the product enabled by the seed script.

## 8. Frontend (`src/modules/marketing/`, mirrors Booking/CRM)

- `api.ts` — `MarketingApiError` + throw-on-error `call<T>` + `marketingApi`
  (`listCampaigns`, `getCampaign(id)`, `createCampaign(body)`, `audienceCount(audience)`, `send(campaignId)`)
  + types `Campaign`, `CampaignSend`, `CampaignDetail`, `AudienceCount`.
- `format.ts`, `shared/permissions.ts` (`canViewMarketing`, etc.), `MarketingRouteMounts.tsx`
  (`gate()` factory + `ALL_MARKETING_PERMS` + L1 bypass `level_number == null || === 1`; exports
  `MarketingListMount`, `MarketingComposeMount`, `MarketingDetailMount`).
- **CampaignsListPage** (`/c/:slug/marketing`): table (name / audience / status / sent_at) + "New campaign"
  → compose; empty / loading / error.
- **CampaignComposePage** (`/c/:slug/marketing/new`): controlled form (name, subject, `body_html` textarea,
  audience `<select>`); a **live HTML preview** pane (renders `body_html`); a **live audience count** that
  re-queries on audience change; "Save draft" → creates and routes to detail. Error/busy handled.
- **CampaignDetailPage** (`/c/:slug/marketing/:id`): campaign summary + audience count + body preview +
  **Send** button (only when `draft` and `perms.has('marketing.customers.edit')`) + the **sends log** table
  (recipient / status / time) with an empty-state; loading / error handled. Golden flow lands here.
- `.mkt-*` CSS block in `src/lib/components.css` (reuse `.page`, `.pm-table`, `.pm-search`, `.muted`,
  `.btn`, `.error`, `.pm-empty`). Wire-up: `src/lib/router.tsx` (3 routes; static `marketing/new` ranks
  above `marketing/:id`), `useNavItems.ts` (`'marketing'` in `MODULES_WITH_DEDICATED_NAV`), `Sidebar.tsx`
  (`marketingEnabled` + `showMarketing` gate + NavLink + group guard).

## 9. Seed, tests, verification

- `scripts/seed-marketing.ts` + `"seed:marketing"`: direct `neon(DATABASE_URL)`; resolve `papa-s-saloon`;
  enable the `marketing` product (`client_enabled_products`, idempotent); insert **1 `draft`** campaign and
  **1 `sent`** campaign with a few `campaign_sends` rows (so detail/log isn't empty).
- Tests (`tests/marketing/*`, helpers modeled on `tests/crm/_helpers.ts`; CRM touches no Blobs → **no
  `getStore` mock**):
  - authz (401 / 412 module-disabled / 403 L2-no-perm / L1 bypass);
  - create → `draft` row;
  - **audience-count correctness** — seed `crm_customers` with a mix (email vs null-email, recent vs old
    `last_seen`) → count reflects the `email is not null` + `recent_30d` filters;
  - send → `campaign_sends` rows (`status='logged'` in tests, no `RESEND_API_KEY`) + campaign flips to
    `sent`; **re-send → 409**.
  - Randomize unique-constrained literals (shared persistent dev DB, no teardown —
    `feedback_tests_share_persistent_dev_db`).
- **Done gate** (`CLAUDE.md`): `npm run typecheck` AND the FULL vitest suite green; then golden-flow smoke
  via `netlify dev --port 5193 --target-port 8903` (or an API smoke through real routing, as done for CRM).

## 10. Platform-pattern checklist (each has burned us before)

- [ ] Migration uses reserved **060**; one statement per line; no inline comment after `;`.
- [ ] ModuleManifest **and** a ProductManifest entry; product enabled for the demo tenant by the seed.
- [ ] Permission keys bucket×verb only (`marketing.customers.<verb>`).
- [ ] `_marketing-authz.ts` enable-gate + `level_number===1` bypass; same bypass in Sidebar + RouteMount.
- [ ] Netlify functions flat top-level; list+create share a path → both set `config.method`; send avoids a
      literal sub-path under `:param`.
- [ ] FE mirrors Booking/CRM: shared types + throw-error API layer + perms in a shared dir; `.mkt-*` CSS.
- [ ] Tests randomize unique literals; full suite green; no Blobs → no getStore mock.
- [ ] `scripts/seed-marketing.ts` seeds realistic papa-s-saloon data.
- [ ] Verification: `npm run typecheck` + full vitest, both green; golden-flow smoke.
- [ ] Fresh worktree: `npm install` before typecheck/build/tests (`feedback_stale_worktree_node_modules`).

## 11. Open items to resolve during planning (do not fabricate)

1. **Test env `RESEND_API_KEY`** — the send tests rely on it being ABSENT so `deliver()` takes the
   dev-fallback (`logged`) instead of the network. Confirm how the Email module's tests
   (`tests/email/outbox.test.ts`) handle this and mirror it; if `.env` carries the key, the test must
   `delete process.env.RESEND_API_KEY` (or equivalent) before invoking send.
2. Confirm the exact `deliver` import path + `DeliveryResult` shape against `_shared/resend.ts` at build
   time (mailer explorer report is the source; verify).
3. `MAIL_FROM` default — reuse the mailer's default (`'notifications@example.com'`) if unset. No NEW env
   vars for dev (dev-fallback). Live sending reuses Email's existing `RESEND_API_KEY` + `MAIL_FROM`.

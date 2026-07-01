# POS Session Handoff — 2026-06-30 (updated 2026-07-01)

**Living trail.** Update this at every milestone so no work is lost. Newest status at top of each section.

## Operating context (read first)
- **This chat = POS only.** It works in **isolated git worktrees on feature branches** and **never pushes or merges**. The **mainframe chat owns `main` / prod / merge / deploy**. Deliverables are handed off as paste-ready prompts.
- Current `origin/main` = `fb13a87` (POS v1+v2 + all fixes below are already integrated to prod).
- Shared **dev** Neon endpoint: `ep-bold-wildflower-aoi9zvbd` (the `.env` DATABASE_URL). Prod is separate — migrations must be run on prod by the mainframe.
- Test/verify gate: `npm run typecheck` + `npx vitest run` (there is **no** `lint` script). Worktrees need `node_modules` symlinked + `.env` copied from the main worktree.

## Current state (2026-07-01): POS is feature-complete + live
The full POS surface — staff POS (v1), public guest-checkout storefront (v2), perms (L1 all-on + granular L2 grants), stylesheet, and post-merge UX/perf fixes — is **shipped to prod**. Two threads remain: **branding** (delegated to the AMS/branding chat) and **v2.5 online payment** (design-only, awaiting keys).

## Shipped to prod (integrated by mainframe)
| Work | Landed as | Notes |
|---|---|---|
| Perms: L1 Owner all-on + POS in `enabled_modules` + granular `pos.*` grants (Phases 1+2) | on main | Fixed the "shipped-but-undeliverable" gap |
| POS stylesheet (`pos.css`, 26+ classes) + storefront shell CSS | on main | |
| Menu side-cart qty decrease / remove (was add-only) | on main | |
| v2 public storefront (guest checkout, 4 pub endpoints, migs 043–045) | on main | pay-on-pickup only |
| UX fixes: drawer read-after-write refetch + Sale History "Storefront" badge | `622cebd` | |
| Drawer optimistic status flip (unblock pill from cold refetch) | `fb13a87` (current HEAD) | +test asserting flip before refetch resolves |

Prod migrations applied through `049` (Booking). No POS migration is pending.

## In progress — delegated, NOT this chat's to build
### Platform branding (was POS v3) → AMS/branding chat
- Reclassified from a POS feature to a **shared platform domain** per **ADR-0001**. The v3 POS-local implementation (branch `feat/pos-v3-branding-iso`) is the **extraction source — do NOT merge it as POS-local.**
- The AMS/branding chat owns `feat/platform-branding-iso` (worktree `../ExSol-Branding-WT`), currently at **design/spec stage** (`docs/superpowers/specs/2026-07-01-platform-branding-design.md`), no implementation yet.
- **POS's part = a consume-refactor** (drop v3-local branding, wrap storefront pages in shared `BrandShell` + `useBrand(slug)`), **blocked** until they ship the shared domain + contract.
- **Consumer-review handoff already sent to the branding chat** flagging two blockers for a clean POS consume: (1) dropping `pub-image` orphans storefront **product photos** (v3's `pub-image` served both brand + product images; the new brand-image endpoint validates brand keys only) — needs a product-image public endpoint or a generalized image endpoint; (2) POS storefront layout CSS is scoped under `.storefront-shell` and will orphan when it becomes `.brand-shell` (`.brand-main` must carry the content-column max-width/padding; checkout-narrowing rules must be re-scoped). Plus two doc-tweak notes.

## Design-only — awaiting Razorpay keys (do NOT build yet)
### POS v2.5 — online payment (Razorpay)
- **Spec:** `docs/superpowers/specs/2026-07-01-pos-v2.5-online-payment-design.md` on branch `feat/pos-v2.5-payments-iso` (worktree `../ExSol-POS-v2.5-WT`, HEAD `fae9fff`). **Docs-only commit — safe to merge; nothing to deploy.**
- Per-tenant Razorpay keys (funds direct to tenant); two per-method toggles (pickup/online → Both/One/None); create-sale-`pending_payment`-then-webhook-confirms; server-computed amounts; secrets AES-256-GCM at rest.
- **When built (coordination):** (1) migration `051` is provisional — assumes branding takes `050`; confirm next free integer (prod at `049`). (2) New env var **`RAZORPAY_ENC_KEY`** (base64 of 32 bytes) required in **every** Netlify context (KEK; endpoints fail-closed without it). (3) Each tenant supplies own Razorpay creds via settings; webhook URL = `/api/pos/razorpay-webhook`.
- Implementation on hold per user (design-only until keys). No implementation plan written.

## Open follow-ups (not blocking)
- **POS branding consume-refactor** — blocked on the branding chat shipping the shared domain (above).
- **v2.6:** Cloudflare Turnstile on `pub-sale-create` (env-gated, platform-wide) — deferred from v2.5.
- **Audit attribution (Low, pre-existing):** `pos-sale-state.ts` / `pos-sale-create.ts` hardcode `level_number: 1` in the audit session → L2 POS transitions misattributed. ~15 LOC. (Verify still present before fixing.)
- **Validator defense-in-depth (Low):** `isValidPermissionKey` doesn't re-check `posProduct.requires`.
- Parked: abandoned-online-order auto-expiry cron; Razorpay refunds; KEK rotation job (all in the v2.5 spec §10).

## Memory caveats verified this session
Netlify: flat function layout (depth 3) + `config.path`+`config.method`; new-function 404 → `restoreSiteDeploy`; Blobs not shared across functions (rate limiter uses Blobs, tests mock `getStore`). Migrate runner keys by full filename (same-number files across chats coexist, but confirm prod ordering). Read-after-write on Neon: a `GET` refetch immediately after a `POST` write can be stale — prefer the authoritative write response for the UI (drawer fix). Tests share a persistent dev DB with no teardown — randomize unique-constrained literals.

## Suggested skills for the next session
- `superpowers:test-driven-development` — every code change here was TDD'd; continue red→green.
- `superpowers:brainstorming` → `superpowers:writing-plans` — for turning the v2.5 spec into an implementation plan once keys arrive.
- `superpowers:requesting-code-review` / a `pr-review-toolkit:code-reviewer` subagent for any security-relevant change before handoff (v2.5 payment code especially).
- `superpowers:using-git-worktrees` — new POS work = new worktree off current `origin/main`, symlink `node_modules`, copy `.env`.

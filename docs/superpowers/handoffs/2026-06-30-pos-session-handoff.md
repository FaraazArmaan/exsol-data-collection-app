# POS Session Handoff — 2026-06-30

**Living trail.** Update this at every milestone so no work is lost. Newest status at top of each section.

## Operating context (read first)
- **This chat = POS only.** It works in **isolated git worktrees on feature branches** and **never pushes or merges**. The **mainframe chat owns `main` / prod / merge / deploy**. Deliverables are handed off as paste-ready prompts.
- Base commit for all branches below: `origin/main` = `69df370`.
- Shared **dev** Neon endpoint: `ep-bold-wildflower-aoi9zvbd` (the `.env` DATABASE_URL). Prod is separate — migrations must be run on prod by the mainframe.
- Test/verify gate: `npm run typecheck` + `npx vitest run` (there is **no** `lint` script). Worktrees need `node_modules` symlinked + `.env` copied from the main worktree.

## Deliverables & status

| # | Branch (worktree) | HEAD | Status | What |
|---|---|---|---|---|
| 1 | `fix/pos-l1-access-iso` (`../ExSol-POS-PermFix-WT`) | `ddb7ea4` | **handed off** | L1 Owner all-on for POS + POS in `enabled_modules` (Phase 1) |
| 2 | `feat/pos-action-perms-iso` (same WT) | `1283c4d` | **handed off** | Grant individual `pos.*` actions to L2+ via Access Level UI (Phase 2). **Contains Phase 1** — merging this supersedes #1. |
| 3 | `feat/pos-stylesheet-iso` (`../ExSol-POS-CSS-WT`) | `d8519c0` | **handed off** | `src/modules/pos/pos.css` — the missing POS stylesheet (was 0 rules for 26+ classes) |
| 4 | `fix/pos-cart-qty-iso` (`../ExSol-POS-CartQty-WT`) | `0ce215d` | **handed off** | Menu side cart can decrease qty / remove (was add-only) |
| 5 | `feat/pos-v2-storefront-iso` (`../ExSol-POS-v2-WT`) | `40a7a4f` | **COMPLETE, awaiting handoff/merge** | Public guest-checkout storefront (v2), end-to-end |

All five are committed locally, **none pushed**. Each was independently adversarially reviewed where security-relevant (#1, #2 — both clean, no critical/high).

### Verification snapshot (per branch HEAD)
- #1/#2: typecheck clean; full suite 757 → 772 green.
- #3: typecheck clean; build bundles `pos.css`; 741 green; visual-verified via static render.
- #4: typecheck clean; 48 POS FE tests green.
- #5: typecheck clean; **789 tests green**; production build succeeds.

## POS v2 storefront (#5) — detail
- **Spec (source of truth):** `docs/superpowers/specs/2026-06-29-pos-v2-storefront-design.md`. Implementation follows it; deviations: storefront pages reuse v1 `MenuPage` via two new backward-compatible props (`loadMenu`, `checkoutHref`) + the `guest-` prefix convention in `createCartStore`; `client-settings-storefront` is one function serving GET+PATCH on a unique path.
- **Commits** (see `git log 69df370..40a7a4f` on the branch for full bodies): `88c90ed` migs 043-045 · `d77e4d1` pub-menu · `639db3c` pub-sale-create · `d4b1fb8` pub-sale-detail · `04208c4` settings toggle · `f26632b` v1 source updates · `bb82c4e` FE lib · `fd7c5cb` FE pages+routes · `40a7a4f` StorefrontSettings.
- **Flow:** `/menu/:slug` → `/cart` → `/details` (honeypot) → submit → `/order/:saleUuid` (20s polling receipt). Owner toggle at `/c/:slug/pos/settings`.

### Deploy notes (mainframe) for #5 — NEEDS A PROD MIGRATION
1. Coordinate migration numbers **043-045 with the Booking chat** (it also claims 043+; the runner keys by full filename so distinct names coexist, but confirm prod ordering).
2. `npm run migrate` against **prod** DATABASE_URL (additive only).
3. Merge → push.
4. Probe the 4 new functions post-push (`pub-menu`, `pub-sale-create`, `pub-sale-detail`, `client-settings-storefront`); `restoreSiteDeploy` if they 404.
5. Set **`PUBLIC_BASE_URL`** in the prod Netlify context (`https://exsol.app`).

## Open follow-ups (not blocking)
- **Storefront shell CSS:** `.storefront-shell/header/tenant/main/unavailable/settings` have no rules; menu/tiles/cart/pills inherit from #3's `pos.css`. The chrome is plain until added. *(Most visible next task.)*
- **Settings discoverability:** `StorefrontSettings` mounted at `/c/:slug/pos/settings`, no sidebar link (AMS-chat territory).
- **Audit attribution (Low, pre-existing):** `pos-sale-state.ts` / `pos-sale-create.ts` hardcode `level_number: 1` in the audit session → L2 POS transitions misattributed. ~15 LOC.
- **Validator defense-in-depth (Low):** `isValidPermissionKey` doesn't re-check `posProduct.requires`.
- Parked: v2.5 Razorpay + Turnstile seams; v3 per-tenant branding; PM-form `storefront_visible` checkbox (PM-chat).

## Memory caveats verified this session
Netlify: flat function layout (depth 3) + `config.path`+`config.method`; new-function 404 → `restoreSiteDeploy`; Blobs not shared across functions (rate limiter uses Blobs, tests mock `getStore`). Migrate runner keys by full filename. Cross-branch test-helper duplication avoided (local `seedL2` in #5 tests instead of the perms-branch `seedSubordinateUser`).

## Suggested skills for the next session
- `superpowers:test-driven-development` — every code change here was TDD'd; continue red→green.
- `frontend-design:frontend-design` — for the storefront shell CSS follow-up (match `theme.css` warm-neutral dark tokens; reuse `pos.css` patterns).
- `superpowers:requesting-code-review` / dispatch a `pr-review-toolkit:code-reviewer` subagent for any security-relevant change before handoff.
- `superpowers:using-git-worktrees` — new POS work = new worktree off `69df370`, symlink `node_modules`, copy `.env`.

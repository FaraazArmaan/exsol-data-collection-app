# Platform Branding — progress handoff (living)

**Branch:** `feat/platform-branding-iso` in worktree `ExSol-Branding-WT` (off `origin/main` @ 3763323)
**Spec:** `docs/superpowers/specs/2026-07-01-platform-branding-design.md` (+ ADR `docs/adr/0001-branding-is-a-platform-concern.md`)
**Plan:** `docs/superpowers/plans/2026-07-01-platform-branding.md` (16 tasks)
**Ledger:** `.superpowers/sdd/progress.md` (per-task commit SHAs, git-ignored)
**Scope:** SHARED branding domain only. Do NOT touch `src/modules/pos/**` or `src/modules/booking/**` — §9 is a handback for those chats. No push/merge from this chat.

Updated at milestones (per user request).

---

## MILESTONE 1 — Backend complete + FE-lib foundation (2026-07-01)

**8 / 16 tasks done. All server endpoints + shared helpers + FE pure-lib shipped and green.**

### Done (with commit SHAs)
| Task | What | Commit | Tests |
|---|---|---|---|
| 1 | Migration 050 — 11 `brand_*` columns on `clients` | `e83046f` | 4/4 schema |
| 2 | `_shared/brand.ts` — store, UUID-scoped keys, `keyBelongsToClient`, `sniffImageMime`, `resolveClientBySlug` (module-agnostic) | `48b2443` | 8/8 unit |
| 3 | `POST /api/client-settings/brand-image` — authed multipart, magic-byte anti-spoof | `4f342c5` | 6/6 integ |
| 4 | `PATCH /api/client-settings/brand` — partial CASE-per-column UPDATE, cross-tenant guard | `2b86303` | 8/8 integ |
| 5 | `GET /api/public/brand/:slug` — module-agnostic brand payload | `1faf86a` | 2/2 integ |
| 6 | `GET /api/public/brand/:slug/image/:key` — ownership-validated stream (leak guard) | `8555e6d`+`f6d6c7d` | 5/5 integ |
| 7 | `src/modules/branding/branding.ts` — color helpers (ported POS v3) + 14-font allowlist | `2a1848d` | 8/8 unit |
| 8 | `src/modules/branding/types.ts` (Brand contract) + `downscale.ts` | `3a6892f` | 2/2 unit |

All tasks: TDD (RED→GREEN), `npm run typecheck` clean, committed on-branch. Security-critical tasks (2, 4, 6) passed an independent read-only reviewer subagent (spec ✅ + code-quality APPROVED); review findings folded in (hardened traversal test, cross-tenant leak test, error-code assertions).

### Remaining (Tasks 9–16 — all FE)
- 9: `brand-fonts.ts` + `npm install` 14 `@fontsource*` pkgs + import in `src/main.tsx`
- 10: `useBrand.ts` hook
- 11: `BrandShell.tsx` (theme/accent/font props + favicon/apple-touch-icon injection)
- 12: `BrandHero.tsx` (auto-rotating carousel)
- 13: CSS (light-theme tokens + `.brand-*`) + `index.ts` barrel
- 14: `BrandingForm.tsx` (shared 4-section settings form)
- 15: `WorkspaceBrandingCard` + `AdminWorkspaceBrandingCard` wrappers
- 16: mount on `UserAccount` + `AccessDashboard`, full suite, smoke

### Environment gotchas (for anyone resuming)
- Fresh worktree needed `npm install` + a copied `.env` (git-ignored) before any test ran.
- **Spawned subagents in this session cannot use Bash** — implementer-subagents are impossible here. Execution is inline-implement + read-only-reviewer-subagent (reviewers only Read/Grep, which works).
- Tests share the one dev Neon DB; seed clients via the `clients` HANDLER (NOT raw INSERT — `clients` has NOT-NULL `template_key`/`schema_name`/`created_by`). Admins need `is_bootstrap: true` to pass perms. Rate-limited public endpoints need `vi.mock('@netlify/blobs', …)`.
- The repo has NO `sql.query(...)` — use Neon tagged-templates only (PATCH uses a `CASE WHEN <supplied> THEN <value> ELSE <col> END` per column).

### Deploy notes (for the parallel chat, when this lands)
- Migration 050 additive; `npm run migrate` on prod before/with code (safe either order).
- New npm deps in Task 9 (`@fontsource*`) — FE static assets, no `external_node_modules` change.
- 4 new functions — probe post-deploy for the Netlify new-function 404 trap; `restoreSiteDeploy` if any 404.
- No new env vars.

### Consume-contract status (§9)
Reviewed by BOTH the POS chat (2 blockers folded in — retain a POS product-image endpoint; `.brand-main` carries the content column) and the Booking chat (5-point recipe, no blockers). Handback ready once FE lands.

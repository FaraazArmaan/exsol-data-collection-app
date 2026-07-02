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

---

## MILESTONE 2 — Feature complete, full suite green (2026-07-01)

**16 / 16 tasks done. `HEAD = 1dcac46`, 24 commits ahead of `origin/main`. FULL SUITE 1011/1011 across 160 files. Typecheck clean. Build clean (83 WOFF2 subset assets emitted).**

### FE tasks completed since Milestone 1
| Task | What | Commit | Tests |
|---|---|---|---|
| 9 | Self-hosted 14 `@fontsource*` fonts + `brand-fonts.ts` + `main.tsx` wire | `9386be0` | build+typecheck |
| 10 | `useBrand.ts` hook | `e8a19fc` | 3/3 |
| 11 | `BrandShell.tsx` (theme/accent/font props + icon injection) | `2237361` | 5/5 |
| 12 | `BrandHero.tsx` (auto-rotating carousel) | `cf5ff6e` | 4/4 |
| 13 | Light-theme CSS + `.brand-*` + `.brand-main` column + `index.ts` barrel | `ced30df` | build |
| 14 | `BrandingForm.tsx` (shared 4-section form) | `2cb8079` | 4/4 |
| 15 | `WorkspaceBrandingCard` + `AdminWorkspaceBrandingCard` | `7319ad9` | 4/4 |
| 16 | Mounts (UserAccount + AccessDashboard) + full suite | `1dcac46` | 1011/1011 |

### Consume contract (§9) is ready to hand back
The `src/modules/branding/index.ts` barrel exports `{ BrandShell, BrandHero, useBrand, Brand, onAccent, isHexColor, isAllowlistedFont, suggestAccentFromLogo, downscaleImage, MAX_EDGE, BRAND_FONT_ALLOWLIST }`. Public endpoints live and tested: `GET /api/public/brand/:slug`, `GET /api/public/brand/:slug/image/:key`. POS + Booking chats can start their refactor per §9.4 / §9.5.

### Final whole-branch review
APPROVED FOR MERGE (Opus, read-only). No Critical/Important. Contract-consistency ✅ across all 5 layers; image URL round-trip verified inverse; font allowlist↔imports↔deps 1:1; zero POS/Booking source touched. Two Minors are the documented v1.1 follow-ups (admin-card first-paint slug='' cosmetic; useBrand no auto-refetch).

### Deferred v1.1 follow-ups (non-blocking, logged in ledger)
- Hero drag-reorder + per-slide delete (form currently appends).
- `useBrand` auto-refetch after save (currently optimistic).
- SSR OG-meta injection for `socialUrl` (inert until SSR exists).
- Tenant custom-font upload; live preview panel.

---

## MILESTONE 3 — BrandingForm redesign + file-picker fix; upload "bug" triaged (2026-07-03)

**Status: DONE + LIVE. No open code work on platform branding.**

### UI redesign + file-picker fix — shipped as `9c9af2f`
Redesigned the `BrandingForm` settings panel (logo tile grid with transparency-checkerboard previews + drag-drop, hero dropzone + thumbnail strip, real accent color picker + "Suggest from logo", segmented Dark|Light, grouped font selects). Fixed the original "Choose file doesn't open" bug — root cause was a native `<input type=file>` nested in a `<label>`, mangled by the global `label { flex-direction:column }` rule; replaced with hidden ref-driven inputs triggered by `ref.current.click()` from the tile/dropzone. Two files only: `src/modules/branding/BrandingForm.tsx` + `src/lib/components.css`.

- **Merged + deployed** on `origin/main` as `9c9af2f`. Verified in the LIVE prod bundle (`index-DaWSO4dh.js` / `index-C-BlDxy1.css`): contains `brand-tile`/`brand-dropzone`/"Hero carousel", zero `brand-upload-slot`.
- **Merge-check caveat:** `git merge-base --is-ancestor 0685764 origin/main` returns NOT-MERGED (false-negative) — main took the change under rebased SHA `9c9af2f`. Confirm branding merges by CONTENT (per-file diff vs `origin/main`), not by the polish-branch SHA lineage.

### 2026-07-03 "upload button doesn't open file explorer" report → NOT a code bug
Reported broken again on prod. Systematic triage (browser console probes) proved: the fix is live, `input.click()` fires on a connected+enabled input, zero JS errors, zero Chromium `[Violation]`, no dialog — and it failed for EVERY file input app-wide (Files, Product too), yet worked in a real browser. Root cause: the report was being tested inside an **automation-controlled Chrome (Playwright/CDP) which suppresses the native file chooser by design**. No code change. See memory `feedback_playwright_suppresses_file_chooser`.

### Worktree repurposed for future branding work
`ExSol-Branding-WT` was retained (not deleted) and moved to a fresh branch **`feat/branding-iso`** based on latest `origin/main` — a clean base for future branding features. The old polish branch **`feat/ams-branding-ui-polish-iso` @ `e8f3f47`** is preserved (holds earlier handoff-doc corrections). Run `npm install` in the worktree before the next feature session (main may have added deps since).

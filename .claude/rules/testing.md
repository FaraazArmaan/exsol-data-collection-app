# Testing rules

"Done" = `npm run typecheck` AND the FULL vitest suite (`npm test`), both green. No exceptions,
no "only the tests I touched". ~230 files / ~1330 tests, ~2 min.

## The dev DB is persistent and shared

There is NO per-test teardown, and every terminal/chat shares the same Neon dev branch:

- **Randomize every unique-constrained literal** (slugs, emails, SKUs, phone numbers) —
  `crypto.randomUUID()` fragments, not `'test-client'`. Re-runs collide otherwise
  (dup key, or gist `23P01` for booking time-range EXCLUDE constraints — keep seeded bookings on
  distinct time ranges).
- Leftover fixtures accumulate; `npx tsx --env-file=.env scripts/clean-test-fixtures.ts` prunes
  them (it echoes the DB host and preserves non-test clients).

## Blobs

Mock `getStore()` in EVERY test file whose handler touches Netlify Blobs — including tests that
only exercise the handler incidentally. Adding a `getStore(...)` call to an existing handler
crashes every test that exercises it (sync throw; `.catch()` does not save you). Grep for other
test files of that handler and add the mock everywhere.

## What tests CANNOT catch (verify by hand)

- **Routing**: integration tests import handlers directly, bypassing Netlify's name-based routing
  and `config.path`/`config.method` collisions (iron rule 5). Probe real URLs after deploy.
- **CSS**: jsdom doesn't evaluate CSS custom properties — a module styled with invented vars ships
  white-on-white with a fully green suite (iron rule 9). Check a REAL browser.
- **Browser file dialogs**: automation-controlled Chrome suppresses the native file chooser; an
  "upload doesn't open" symptom under Playwright with no console error is the tool, not the code.

## Conventions

- Integration tests live in `tests/integration/*.test.ts` (call handlers directly with a real
  session cookie); unit tests in `tests/unit/` or `src/**/__tests__/`.
- jsdom component tests start with `// @vitest-environment jsdom` (the global default is `node`).
- `tests/setup-env.ts` loads `.env` before handler modules are imported (env.ts/db.ts cache on
  first call) — it is wired via vitest `setupFiles`; do not remove it.
- When asserting on shell/vitest output in scripts or CI-ish loops: vitest's exit code is the
  truth; NEVER pipe `npm test` through `tail`/`grep` without `set -o pipefail` — the pipe eats
  the failure.

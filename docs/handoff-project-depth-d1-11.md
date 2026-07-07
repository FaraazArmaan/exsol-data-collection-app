# Project Manager Depth (D1.11) — Handoff

**Branch**: `feat/project-depth-iso`
**Base**: `4d48ca5` (main HEAD at branch creation — includes Workforce depth merged)
**Final HEAD**: `ecd3490`
**Migrations used**: 108–111 (all 4 reserved numbers consumed)

## What was built (4 depth features, one commit each)

| # | Feature | Migration | Commit | Tests |
|---|---------|-----------|--------|-------|
| 1 | Project Budget Tracker | 108 | `e5ce39f` | 6/6 |
| 2 | Document Hub | 109 | `e2642ac` | 7/7 |
| 3 | Risk Analytics + Task Tracker | 110 | `509d4c2` | 10/10 |
| 4 | AI Project Planner | 111 | `ecd3490` | 6/6 |

**Total new project tests**: 29/29 (4 new test files)
**Full workforce suite**: 153/153 (17 test files — includes all previous workforce depth tests)

## New tables (4 tables across 4 migrations)

- `public.projects.budget_cents, hourly_rate_cents` — nullable BIGINT columns added to existing projects table (mig 108)
- `public.finance_expenses.project_id` — nullable FK to projects added to existing expenses table (mig 108)
- `public.project_files` — join table linking file records to projects (mig 109)
- `public.project_tasks` — task tracker with due_date, status FSM (open→in_progress→done), assigned_to resource (mig 110)
- `public.project_ai_plans` — persisted AI draft plans with JSONB task list (mig 111)

## New Netlify functions (5 functions)

- `workforce-project-budget.ts` — GET budget summary (timesheet cost + finance expenses) + PATCH set budget/rate `/api/workforce/project-budget/:id`
- `workforce-project-docs.ts` — GET list + POST link + DELETE unlink `/api/workforce/project-docs`
- `workforce-project-tasks.ts` — GET list (status filter) + POST create `/api/workforce/project-tasks`
- `workforce-project-task.ts` — PATCH update + DELETE `/api/workforce/project-task/:id`
- `workforce-project-risk.ts` — GET risk analytics (health score 0-100, overdue/unstaffed/budget flags) `/api/workforce/project-risk/:id`
- `workforce-project-plan.ts` — GET list saved plans + POST generate via AI seam `/api/workforce/project-plan`
- `workforce-project-plan-apply.ts` — POST apply draft tasks → project_tasks `/api/workforce/project-plan-apply`

## Frontend changes

`ProjectDetailPage.tsx` now has 5 tabs:
1. **Overview** — resource assignments (existing)
2. **Budget** — burn % bar, budget vs timesheet cost vs expenses, edit form
3. **Documents** — linked files list, link-by-file-ID form
4. **Tasks & Risk** — health score banner (0-100), flags, task CRUD with status advance
5. **AI Planner** — description textarea → AI generates draft tasks → Apply All saves them

All 5 tabs lazy-load their data (only fetch when the tab becomes active).

## Key implementation notes

1. **Finance expenses cross-module**: Added `project_id FK` to `finance_expenses` in mig 108 — additive and backwards-compatible. Finance module's own endpoints are unaffected.
2. **Document Hub**: Uses `project_files` join table reusing existing `files` records — no new blob storage, no new upload flow. File ownership verified at link time (`client_id` match or admin-uploaded null).
3. **Risk health score**: 100 baseline, deductions for overdue tasks (-10 each, max -30), budget overrun (-30), unstaffed active project (-20), burn > 80% (-10). Clamped to 0-100.
4. **AI planner fallback**: `ask()` never throws; JSON parse failure or empty result falls back to 5 generic tasks. `fallback: true` flag returned to UI for display.
5. **Plan apply**: Loop-INSERTs each draft task individually with 2-branch nullable due_date pattern. Returns count of tasks created.
6. **Nullable patterns**: `due_date` uses 2-branch (null vs `::date`); `assigned_to` uses same. Consistent with workforce depth precedent.

## Integration notes for Main chat

1. Migrations 108–111 are all additive — safe to apply to prod before promoting code.
2. `finance_expenses.project_id` is nullable — existing rows unaffected, finance module unmodified.
3. 7 new Netlify functions to probe post-deploy (restoreSiteDeploy if Edge registration fails).
4. AI planner works keyless (fallback canned response) — no `ANTHROPIC_API_KEY` required for initial deploy.
5. ProjectDetailPage tab count grew from 1 to 5; existing project routes unchanged.

# Workforce Depth Features — Handoff

**Branch**: `feat/workforce-depth-iso`
**Base**: `00179bd` (main HEAD at branch creation)
**Final HEAD**: `6647ee0`
**Migrations used**: 112–119 (all 8 reserved numbers consumed)

## What was built (8 depth features, one commit each)

| # | Feature | Migration | Commit | Tests |
|---|---------|-----------|--------|-------|
| 1 | Leave Requests & Compliance Tracker | 112 | `8e2a7b1` | 11/11 |
| 2 | Smart Punching (clock in/out vs shift) | 113 | `17370cb` | 6/6 |
| 3 | Overtime Tracker (log + approve) | 114 | `47c0291` | 7/7 |
| 4 | Shift Swap Board (offer/claim/approve/deny) | 115 | `f3d2ba5` | 13/13 |
| 5 | Payroll Tracking (rates + periods + line items) | 116 | `7ded8a9` | 15/15 |
| 6 | Training Tracker (courses + completions + expiry) | 117 | `d736eda` | 8/8 |
| 7 | Asset Tracker (inventory + assignments) | 118 | `4472b3f` | 15/15 |
| 8 | Employee Tracking Dashboard | 119 | `6647ee0` | 6/6 |

**Total workforce tests**: 124/124 (13 test files)

## New tables (8 tables across 8 migrations)

- `public.leave_requests` — leave request workflow (pending → approved|denied)
- `public.leave_balances` — per-resource balance per leave type
- `public.workforce_punches` — clock-in/out with shift match + late_minutes
- `public.overtime_entries` — OT hours with approval workflow
- `public.shift_swaps` — offer/claim/approve/deny/cancel FSM
- `public.payroll_rates` — hourly rate per user_node with effective date
- `public.payroll_periods` — pay periods with line-item computation
- `public.training_courses` — certifiable courses with expiry
- `public.training_completions` — per-resource completion with expiry_status
- `public.workforce_assets` — equipment inventory (condition: good/fair/poor/retired)
- `public.asset_assignments` — assignment history per user_node

## New Netlify functions (18 functions)

- `workforce-leaves.ts` — GET+POST /api/workforce/leaves
- `workforce-leave.ts` — PATCH+DELETE /api/workforce/leave/:id
- `workforce-compliance.ts` — GET /api/workforce/compliance (flags: max_hours, missing_break)
- `workforce-punches.ts` — GET+POST /api/workforce/punches
- `workforce-punch.ts` — PATCH+DELETE /api/workforce/punch/:id
- `workforce-overtime.ts` — GET+POST /api/workforce/overtime
- `workforce-overtime-id.ts` — PATCH+DELETE /api/workforce/overtime/:id
- `workforce-swaps.ts` — GET+POST /api/workforce/swaps
- `workforce-swap.ts` — PATCH+DELETE /api/workforce/swap/:id
- `workforce-payroll.ts` — GET+POST /api/workforce/payroll (periods)
- `workforce-payroll-id.ts` — GET+PATCH+DELETE /api/workforce/payroll/:id
- `workforce-payroll-rates.ts` — GET+POST /api/workforce/payroll-rates
- `workforce-training-courses.ts` — GET+POST /api/workforce/training-courses
- `workforce-training-course.ts` — PATCH+DELETE /api/workforce/training-course/:id
- `workforce-training-completions.ts` — GET+POST /api/workforce/training-completions
- `workforce-assets.ts` — GET+POST /api/workforce/assets
- `workforce-asset.ts` — PATCH+DELETE /api/workforce/asset/:id
- `workforce-asset-assignments.ts` — GET+POST+PATCH /api/workforce/asset-assignments
- `workforce-employee-profile.ts` — GET /api/workforce/employee-profile

## New frontend pages (8 pages)

- `LeaveRequestsPage.tsx` — route: `workforce/leave`
- `SmartPunchingPage.tsx` — route: `workforce/punching`
- `OvertimePage.tsx` — route: `workforce/overtime`
- `SwapBoardPage.tsx` — route: `workforce/swaps`
- `PayrollPage.tsx` — route: `workforce/payroll`
- `TrainingPage.tsx` — route: `workforce/training`
- `AssetsPage.tsx` — route: `workforce/assets`
- `EmployeeDashboardPage.tsx` — route: `workforce/employees`

## Manifest changes

`src/modules/registry/manifests/workforce.ts` — `data_buckets` extended:
- Previously: `['employees']`
- Now: `['employees', 'leave', 'payroll', 'assets']`

`src/modules/registry/types.ts` — `DATA_BUCKETS` union type extended with `'leave' | 'payroll' | 'assets'`.

`ALL_WORKFORCE_PERMS` in `_workforce-authz.ts` and `WorkforceRouteMounts.tsx` extended with 12 new keys:
- `workforce.leave.{view,create,edit,delete}`
- `workforce.payroll.{view,create,edit,delete}`
- `workforce.assets.{view,create,edit,delete}`

## Key implementation decisions

1. **DATA_BUCKETS extended**: `src/modules/registry/types.ts` had a closed 4-value union. Added `leave`, `payroll`, `assets` to support new manifest buckets without breaking the validator.

2. **Neon ::text cast required**: All string parameters in WHERE clauses need explicit `::text` cast even for TEXT columns, or Neon's edge proxy can't infer type. Pattern established: `(${param}::text IS NULL OR col = ${param}::text)`.

3. **jsonError response shape**: `{ error: { code: string, ...details } }` — NOT flat `{ code }`. Tests use `data.error.code`.

4. **Nullable UUID INSERTs**: 2-branch approach for 1 nullable UUID, 4-branch for 2 nullable UUIDs. The `${null}::uuid` pattern does NOT work reliably in Neon template literals.

5. **config.path overrides**: Functions with names that don't match their desired route use explicit `config.path`. No two functions share config.path without config.method set.

6. **Payroll line items**: Computed via correlated subquery (latest effective rate before period_start) rather than a JOIN, to correctly handle the "most recent rate" requirement.

7. **Asset soft-delete**: `condition = 'retired'` is the soft-delete pattern. Default GET excludes retired unless `?condition=retired` is explicitly requested.

8. **Employee profile**: 10+ parallel Postgres queries (Promise.all) to keep response time acceptable. Assets require a two-step query (get user_node_id from punches, then get assignments).

## Known limitations / deferred

- **Compliance tracker** (`workforce-compliance.ts`): Break detection is approximate — checks adjacent timesheet entries for 20-min gaps. Overlapping or non-sequential entries may give inaccurate results.
- **Payroll**: `workforce.payroll.view` perm gates the entire payroll surface. Sensitive: consider a separate "payroll admin" access level before going live.
- **Swap board claim**: Requires selecting a claiming resource from a dropdown — there's no "claim as myself" shortcut since the resource↔user_node mapping isn't surfaced in the session.
- **Employee Dashboard assets**: Relies on finding the resource's `user_node_id` from their most recent punch record. If a resource has never punched in, their assets won't appear.
- **No real-time notifications** for swap/leave approvals — purely pull-based.

## Integration notes for Main chat

When merging this branch to main:
1. Migrations 112–119 must be applied to **prod** before code promote (they are all additive — safe to run first).
2. `DATA_BUCKETS` type extension in `types.ts` may surface in the conformance checker — this is intentional, not debt.
3. The 18 new Netlify functions will auto-deploy; probe `/api/workforce/leaves` post-deploy in case of Edge registration issue (see `netlify api restoreSiteDeploy` fix pattern).
4. Access Levels UI will automatically show the new `leave`, `payroll`, `assets` buckets for the Workforce module after the next product manifest sync.

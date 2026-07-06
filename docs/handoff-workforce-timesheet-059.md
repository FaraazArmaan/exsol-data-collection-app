# Workforce + Timesheet — Handoff (2026-07-06)

## Branch

`feat/workforce-psrm-iso` — worktree at `../ExSol-Workforce-WT`

**HEAD**: `e02071f`  
**Merge-base (main)**: `dff6f244`

## Commits (chronological)

| SHA | Description |
|-----|-------------|
| `60ea8ce` | feat(workforce): Workforce + Project Service v1 (059) |
| `39353c8` | feat(workforce/timesheet): add timesheet_entries table to mig 059 |
| `95ec6e2` | feat(workforce/timesheet): backend + tests |
| `442e5e1` | feat(workforce/timesheet): TimesheetsPage + wiring |
| `655ec2a` | fix(workforce/timesheet): correct table name in seed |
| `e02071f` | fix(workforce): final review fixes |

## What's in this branch

### Core Workforce + Project Service (60ea8ce)

**Tables** (all in migration 059, applied to dev DB):
- `workforce_shifts` — recurring weekly schedule templates (resource, weekday 0–6, start_time TIME, end_time TIME)
- `projects` — status FSM (`quoted → active → done`), optional `customer_id` FK→`crm_customers`
- `project_assignments` — many-to-many resource↔project
- `timesheet_entries` — actual logged hours per resource/date with approval workflow

**Registry**:
- `workforce` ModuleManifest (`workforce.employees.*` bucket)
- `project-service` ModuleManifest (`project-service.business.*` + `project-service.customers.view`)
- `workforce` ProductManifest (wraps both modules, `requires: ['saloon-booking']`)

**Authz** (`_workforce-authz.ts`):
- Enable-gate: `modules.has('workforce') || modules.has('project-service')`
- L1 Owner bypass returns full `ALL_WORKFORCE_PERMS` set

**Netlify functions** (8 total, flat top-level):
- `workforce-staff.ts` — GET staff directory (booking_resources + user_nodes via client_roles)
- `workforce-shifts.ts` — GET (filter by resource_id) + POST create shift
- `workforce-shift.ts` — DELETE shift
- `workforce-projects.ts` — GET (filter by status) + POST create project
- `workforce-project.ts` — GET detail + PATCH advance FSM
- `workforce-project-assignments.ts` — POST assign + DELETE unassign
- `workforce-timesheets.ts` — GET (filter resource_id/from/to) + POST log entry
- `workforce-timesheet.ts` — PATCH edit/approve + DELETE (blocked if approved)

**Frontend**:
- `WorkforcePage` — staff directory + 7-column weekly schedule grid with shift pills
- `ProjectsPage` — project list with status badges + create form
- `ProjectDetailPage` — FSM advance button + resource assignment management
- `TimesheetsPage` — Monday-anchored week picker, entries grouped by resource, log form, approve/delete actions
- All mounts in `WorkforceRouteMounts.tsx` (4 exports: Workforce, Projects, ProjectDetail, Timesheets)
- Routes wired in `router.tsx`
- Sidebar entry gated on `showWorkforce`

**Tests**: 1215 total (baseline 1200 + 15 timesheet tests). All passing.

**Seed**: `npm run seed:workforce [slug]` — enables products, creates shifts + projects + assignments + 3 timesheet entries for current week.

## Known deferred items (from final review — Minor, non-blocking)

1. `handleGet` in `workforce-timesheets.ts` — malformed `?from=` or `?resource_id=` param causes Postgres 22007/22P02 → 500 instead of 400. Low priority; easy to hit only with intentionally bad input.
2. `workforce-project-assignments.ts` DELETE — resource ownership not re-verified (POST guards it, so no exploitable path today).
3. Backend `requireWorkforce` uses OR (`modules.has('workforce') || modules.has('project-service')`); frontend `workforceEnabled` checks only `m.key === 'workforce'`. Inert today (single product wraps both), worth aligning if the product is ever split.
4. No test for time-order constraint violation (`end_time < start_time`) in shifts or timesheets.

## Merge constraint

**MERGE ONLY AFTER CRM (055) IS MERGED TO MAIN** — `projects.customer_id` FKs `crm_customers(id)`. The FK is `ON DELETE SET NULL` so a missing CRM table blocks migration.

## Golden flows to verify after merge

1. Workforce → Staff & Schedule → see weekly shift grid per resource
2. Workforce → Projects → open an active project → assign a resource → advance status
3. Workforce → Timesheets → see entries for the current week → log a new entry → approve it

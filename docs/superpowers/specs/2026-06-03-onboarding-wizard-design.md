# Onboarding Wizard — Design

**Date:** 2026-06-03
**Status:** Approved — implementation plan to follow
**Predecessors:** [2026-05-26-ams-module-design.md](./2026-05-26-ams-module-design.md), [2026-05-27-ams-v3-hierarchy-design.md](./2026-05-27-ams-v3-hierarchy-design.md), [2026-06-01-access-levels-design.md](./2026-06-01-access-levels-design.md), [2026-06-03-manage-team-design.md](./2026-06-03-manage-team-design.md)

## 1. Problem

Today, onboarding a new client to a working state requires **~9 manual admin steps across 6+ API endpoints**:

1. `+ Add Client` modal → name + create row.
2. Navigate to the empty dashboard.
3. ConfigureStructure → add Role(s).
4. ConfigureStructure → add Level(s) with allowed roles.
5. ConfigureStructure → set cardinality rules.
6. ConfigureStructure → toggle enabled Products.
7. Back to dashboard → `+ Add user`.
8. Fill Owner details + temp password.
9. Submit.

Each step is its own UI surface. The admin can drop the client mid-setup (forgetting to add levels, or to enable products, or to seed the Owner) and ship a broken workspace. The current `AddClientModal` is a 48-line file that just creates a `(name, slug)` row — the *rest* of the setup is on the admin's discipline.

## 2. Goal (v1)

Replace `AddClientModal` with a 6-step linear stepper wizard that:

1. Collects all setup data in one flow (Name → Products → Roles → Levels → Cardinality → Owner).
2. Submits to a **new server endpoint** (`POST /api/onboard-client`) that wraps every insert in a single Postgres transaction — all-or-nothing semantics, no half-onboarded clients.
3. On success, redirects to the new client's `/clients/:id` dashboard, which (because the wizard already created roles/levels/Owner) renders a populated AccessDashboard ready for further work.
4. Supports "Skip" on every step except **Name** and **Owner**, preserving the lightweight "just give me a working client with the minimum" path (1 role, 1 level, no cardinality, no enabled products, 1 Owner).

The hierarchical user/role/level/bucket-family AMS surface (AccessDashboard, ConfigureStructure, AccessLevelDashboard) is **untouched** — the wizard only accelerates initial setup. All ongoing structural management continues to happen in those existing surfaces.

## 3. Non-goals

- **Business-type presets** ("Salon", "Restaurant", "Clinic"). The `clients.template_key` column exists from an earlier design and can be revived later; v1 ships blank-slate only.
- **Wizard resumption** after browser refresh — wizard state is in-memory only.
- **Importing roles/levels from another client.**
- **Permission-matrix configuration during onboarding** — admin configures the matrix in AccessLevelDashboard after the wizard finishes.
- **Multi-Owner seeding** — wizard seeds exactly one L1 Owner. Additional Owners (or users at any level) are added afterwards in AccessDashboard.
- **Editing the wizard's choices via a "re-onboard" flow** — once a client exists, edits happen in ConfigureStructure.
- A **drafts table** for partially-filled wizards.
- **Telemetry** on wizard step abandonment.

## 4. Architecture

### 4.1 Server: new transactional endpoint

`netlify/functions/onboard-client.ts` — admin-only (`requireAdmin`). Single POST. Body shape:

```typescript
{
  name: string;                                  // required, 1–200 chars
  enabled_products: string[];                    // 0+ product keys from src/modules/registry/products.ts
  roles: Array<{
    key: string;                                 // unique within submission, [a-z][a-z0-9_-]*
    label: string;                               // 1–100 chars
    color: string;                               // hex like #3b82f6
    bucket_family?: 'business' | 'employees' | 'customers' | 'products' | null;
  }>;
  levels: Array<{
    level_number: number;                        // 1+, unique within submission, sequential from 1
    label?: string | null;
    allowed_role_keys: string[];                 // references roles[].key in the same submission
  }>;
  cardinality_rules: Array<{
    parent_role_key: string | null;              // null = top-level
    child_role_key: string;
    max_children: number;                        // 1+
  }>;
  owner: {
    display_name: string;
    email: string;                               // valid email
    phone?: string | null;
    notes?: string | null;
    temp_password: string;                       // 8+ chars
  };
}
```

**Key design point — keys, not UUIDs:** Roles, levels, and cardinality rules reference each other by `role_key` / `level_number`, *not* by UUID. UUIDs don't exist until the transaction creates the rows. The endpoint resolves keys → UUIDs inside the txn.

**Transaction sequence** (one `sql.transaction([...])` call):

1. INSERT into `public.clients` (name, slug, created_by). Slug auto-derived with 25-attempt suffix collision handling, identical to the existing `clients.ts` POST.
2. INSERT N rows into `public.client_enabled_products` (one per enabled product).
3. INSERT N rows into `public.client_roles` (one per role), capturing returned IDs into a `roleKeyToId` map.
4. INSERT N rows into `public.client_levels`, resolving `allowed_role_keys` → `allowed_role_ids` via the map.
5. INSERT N rows into `public.client_cardinality_rules`, resolving `parent_role_key` + `child_role_key` → IDs.
6. INSERT into `public.user_nodes` for the L1 Owner. Role is **the first role in the submission whose key matches the first level's first `allowed_role_keys` entry** — i.e., the owner is the "primary role at level 1" by convention. (See §4.5 for rationale + validation.)
7. INSERT into `public.user_node_credentials` for the Owner with `must_change_password = true`, `temp_password_plain = <pw>`, `created_by_admin = <admin_id>`.

**Failure modes** return structured 4xx errors before any DB work, OR rollback-with-409/422 from the txn:

- `400 validation_failed` if Zod fails on the body shape.
- `400 invalid_reference` if any `allowed_role_keys` entry doesn't match a `roles[].key` in the same submission, or any cardinality reference doesn't resolve.
- `409 cardinality_violation` if the seeded Owner would violate a cardinality rule defined in the same submission (e.g., admin defined "max 0 owners at top level" and then asks the wizard to seed one).
- `422 slug_collision` if the 25-attempt suffix loop runs out (extraordinarily rare).
- `409 email_already_has_login_in_this_workspace` if the Owner email collides — but since the workspace is brand new, this can only happen if the admin enters a global-duplicate email; surface a clear error.

Every error body includes `{ section: 'name' | 'products' | 'roles' | 'levels' | 'cardinality' | 'owner' }` so the wizard can jump back to the failing step.

### 4.2 Client: wizard component tree

```
src/modules/ams/components/onboarding/
  OnboardClientWizard.tsx        # modal shell; orchestrates steps; submits to /api/onboard-client
  Stepper.tsx                    # the top progress bar with 6 dots
  state.ts                       # wizard reducer + state shape + per-step validators
  steps/
    NameStep.tsx                 # client name input + live slug preview
    ProductsStep.tsx             # checkboxes from the productRegistry
    RolesStep.tsx                # add/edit list of {key, label, color, bucket_family}
    LevelsStep.tsx               # add list of {level_number, label?, allowed_role_keys}
    CardinalityStep.tsx          # add list of {parent_role_key, child_role_key, max_children}
    OwnerStep.tsx                # display_name, email, phone?, notes?, temp_password
    SuccessStep.tsx              # post-submit summary + "Open workspace" CTA
src/modules/ams/api.ts           # add `onboardClient(body)` wrapper
```

**`OnboardClientWizard.tsx`** owns the wizard reducer state. Each step receives the relevant slice via props plus a dispatch callback. The wizard advances on Next, validates the current step before allowing forward navigation, allows free backward navigation. Final step ("Owner") replaces "Next" with "Create workspace" which calls `onboardClient(state)` and renders `SuccessStep` on success or surfaces the structured error inline.

**`Stepper.tsx`** is purely presentational — renders 6 dots with step labels, current step filled, completed steps checked. Click on a completed step navigates back to it (no skip-ahead).

### 4.3 Replace AddClientModal

The existing `src/modules/ams/components/AddClientModal.tsx` is **deleted**. The "+ Add Client" button in `AdminDashboard.tsx` opens `OnboardClientWizard` instead. The existing `createClient(name)` API wrapper stays exported (other call sites might use it; verify via grep) but is no longer the user-facing path.

If grep finds no other consumers of `createClient`, delete the wrapper too. The underlying `/api/clients` POST endpoint stays — it's still useful for programmatic client creation (scripts, future tooling), just not exposed through the UI.

### 4.4 Skip semantics

| Step | Required? | Skip button? | Notes |
|---|---|---|---|
| Name | Yes | No | Cannot proceed without a name. |
| Products | No | Yes | "Skip" creates client with no enabled products. Admin can enable later in the Products section of AccessDashboard. |
| Roles | Conditional | Yes (with auto-seed) | If admin skips, wizard auto-seeds a single role `{key: 'owner', label: 'Owner', color: '#3b82f6', bucket_family: null}` so the Owner step has something to reference. |
| Levels | Conditional | Yes (with auto-seed) | If admin skips, wizard auto-seeds `{level_number: 1, label: 'Primary', allowed_role_keys: [<owner-role-key>]}`. |
| Cardinality | No | Yes | "Skip" creates client with zero rules (no caps). Admin can add later. |
| Owner | Yes | No | Cannot ship a client without at least one user; the Owner step is the seed. |

A 2-click ("Name → skip → skip → skip → skip → Owner → Create") path therefore exists and gives the admin a "name + 1 role + 1 level + 1 owner" working client.

### 4.5 Owner role/level resolution

The Owner step doesn't ask the admin to pick a role explicitly. Instead, the wizard derives the Owner's role from the data already collected:

- **Role:** the first role in `roles` whose `key` appears in `levels[0].allowed_role_keys`.
- **Level:** `level_number = 1`, `parent_id = null` (top-level).

If the admin defined zero levels or zero roles by the time they reach the Owner step, the auto-seed in §4.4 ensures both exist with sensible defaults. If the admin defined Levels but didn't put any role in Level 1, the Owner step shows an inline error: *"Level 1 has no allowed roles. Go back and assign at least one role to Level 1."*

This avoids a redundant 7th step ("pick the Owner's role") while keeping the model coherent.

## 5. Error handling

| Scenario | UX |
|---|---|
| Network failure during submit | Inline alert with "Retry" button. State preserved. |
| 400 `validation_failed` | Inline alert on the offending step + "Jump to fix" link if the wizard's already past it. |
| 400 `invalid_reference` | Same: identifies which role/level key doesn't resolve. |
| 409 `cardinality_violation` | Jump back to Cardinality step + highlight the violating rule. |
| 422 `slug_collision` | Jump back to Name step ("That name produced a slug already in use; try a small variation"). |
| 409 `email_already_has_login_in_this_workspace` | Jump back to Owner step + highlight email field. |
| Admin clicks Cancel mid-wizard | Confirm dialog ("Discard onboarding? Nothing has been saved yet."); on confirm, close + return to dashboard. No DB cleanup needed because nothing's been written. |

## 6. Testing

### 6.1 Server (integration)

- **Happy path**: full body with 2 roles, 2 levels, 1 cardinality rule, 1 Owner → assert client row + 2 role rows + 2 level rows + 1 cardinality row + 1 user_node row + 1 user_node_credentials row exist, all linked correctly via FKs. Slug derived correctly.
- **Minimum body**: name + auto-seed roles + auto-seed level + Owner only → assert auto-seed produces "owner" role + "Primary" level + Owner node.
- **`invalid_reference` rollback**: body with a `level.allowed_role_keys: ['nonexistent']` → assert 400, AND assert no client row exists post-failure (true transaction rollback).
- **`cardinality_violation` rollback**: body with `{ parent_role_key: null, child_role_key: 'owner', max_children: 0 }` and an Owner → assert 409, AND assert no client row.
- **`slug_collision`**: insert 25 conflicting slugs into clients first, then call onboard with the same name → assert 422.
- **Admin attribution**: created_by_admin on client row, user_node row, credential row all = the calling admin's id.

### 6.2 Client (unit)

- **`state.ts` validators**: `nameStepIsValid`, `productsStepIsValid` (always true), `rolesStepIsValid` (allow empty for auto-seed), `levelsStepIsValid` (allow empty for auto-seed), `ownerStepIsValid` (display_name + email + temp_password all non-empty).
- **Auto-seed logic**: given empty roles + empty levels, the wizard's submit body contains the seeded `owner` role + `Primary` level.
- **Owner role resolution**: with `roles: [Owner, Staff]` and `levels: [{level_number: 1, allowed_role_keys: ['owner']}]`, the wizard correctly identifies the Owner's role as 'owner'.

### 6.3 Manual smoke

1. Admin clicks `+ Add Client` → wizard opens at Name step.
2. Type name "Smoke Test Client" → slug preview shows `smoke-test-client`. Next.
3. Toggle on `saloon-booking`. Next.
4. Add role "Owner" (#3b82f6). Add role "Staff" (#22c55e). Next.
5. Add Level 1 (allowed: Owner). Add Level 2 (allowed: Staff). Next.
6. Add cardinality `{parent: null, child: Owner, max: 1}`. Next.
7. Owner step: display_name "Smoke Owner", email "smoke@example.com", temp_password auto-generated. Click "Create workspace".
8. Verify: redirected to `/clients/<new-id>`, AccessDashboard shows Owner chip at L1 with 🔑 icon, Products section shows saloon-booking enabled, Configure shows 2 roles + 2 levels + the cardinality rule.
9. Click the Owner chip → Edit modal shows the seeded values; LoginManageDrawer shows the temp password peekable.

Then the lightweight smoke:
1. Admin clicks `+ Add Client` → Name "Quick Client" → Next → Skip → Skip → Skip → Skip → Owner step → fill name + email + pw → Create.
2. Verify: client created with the auto-seeded `owner` role + `Primary` level + the new Owner, no Products enabled, no cardinality rules.

## 7. Migration / backwards-compat

- **No DB migration.** All schema already exists.
- **`POST /api/clients`** (the existing thin name+slug endpoint) is **not removed**. It remains usable for scripts and future tooling. Only the UI entry point shifts to the wizard.
- **`createClient(name)` wrapper** in `src/modules/ams/api.ts`: keep unless grep confirms zero remaining consumers.

## 8. Open questions deferred to implementation

- **Auto-generated temp password generator** for the Owner step. Reuse whatever the existing `AddUserNodeModal` uses (likely a `crypto.randomBytes`-based 12-char alphanumeric). Don't invent a new one.
- **Slug preview real-time normalization**: should non-latin characters be transliterated? Use whatever `deriveSlug` from `_shared/identifier.ts` does — the wizard preview must match what the server will actually produce.
- **Cardinality UI affordance**: dropdown picker for parent role + child role, or text inputs? Recommend dropdowns populated from the roles step's data, with "(top-level)" as the parent option for null.

## 9. Suggested next steps

1. User reviews this spec.
2. `superpowers:writing-plans` → implementation plan (~6–8 tasks: endpoint + tests, wizard reducer + validators, 6 step components, replace AddClientModal, smoke).
3. `superpowers:subagent-driven-development` to execute.

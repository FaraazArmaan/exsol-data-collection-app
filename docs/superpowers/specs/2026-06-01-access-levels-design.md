# Access Levels & Per-Level Permissions

**Status:** Implemented (Phases A–C). Endpoint retrofit deferred per-Module.
**Date:** 2026-06-01
**Builds on:** [2026-05-27-ams-v3-hierarchy-design.md](./2026-05-27-ams-v3-hierarchy-design.md)
**Companion reference:** `ExSol Enterprise .pdf` (root of repo) — Step 1 (Login/AMS), Step 2 (Data Buckets), Step 6 (Product Diversification), page 2 (Access Level Dashboard sketch), page 3 (Products × Modules matrix).

## 1. Problem

The AMS today gives each Client a hierarchical user tree (Roles × Levels × parent_id) but every authenticated bucket-user has identical capabilities. There is no policy layer that says "a Tertiary-level employee may view bookings but not delete them." Without that layer, the Primary (the Client's owner/admin) cannot delegate work safely, and every Client looks the same regardless of which Products they use.

The PDF's Step 6 and the page-2 "Access Level Dashboard" sketch make explicit what the policy layer needs to be: **the Primary user, inside each Client, should configure permissions per Level, derived from the Modules that the Client's enabled Products bring in.**

## 2. Goals & non-goals

**Goals**

- Let the Primary user configure CRUD permissions per Level for every relevant (Module, Data Bucket) pair.
- Derive that matrix dynamically from the Client's enabled Products, so new Modules drop in without UI work.
- Keep the existing AMS — Roles, Levels, user_nodes tree, cardinality, Configure page, Access Dashboard chip view — intact and authoritative.
- Add a single small extension to Roles (`bucket_family`) so abstract Data Buckets can map to a Client's custom Roles without hard-coding.
- Enforce permissions server-side via a single middleware that every endpoint opts into. Admins bypass.

**Non-goals (this revision)**

- Per-user overrides on top of per-Level permissions. Future work; YAGNI for v1.
- Time-bounded permissions ("grant this for 24 hours").
- Audit log of permission changes / permission checks. Useful but separate.
- Custom Role permissions independent of Level. Roles stay categorical.
- A UI for Admin to author Module or Product manifests — manifests live in code as TypeScript/JSON committed to the repo.

## 3. Mental model

Three gating layers, top-down:

1. **Admin → Client (Products)**. Admin enables a subset of Products per Client.
2. **Product → Modules**. Each Product is a static composition of Modules (per page 3 of the PDF).
3. **Client (Primary) → Levels (Permissions matrix)**. Primary configures, per Level, which (Module, Data Bucket, Verb) cells are enabled.

The Levels themselves remain numbered (1, 2, 3…) with optional client-set labels. Display labels fall back to `Primary / Secondary / Tertiary / Quaternary / Quinary / Senary / Septenary / "Level N"`.

## 4. Data model

### 4.1 New: Module manifest (code, not DB)

Each Module ships a manifest declaring what it operates on:

```ts
// netlify/modules/booking/manifest.ts
export const bookingManifest = {
  key: 'booking',
  label: 'Booking & Calendar',
  data_buckets: ['customers', 'employees'],         // see §4.3 for the canonical list
  verbs: ['view', 'create', 'edit', 'delete'],      // most Modules use full CRUD; some omit a verb
  vendor_side: true,
  customer_side: true,
} as const;
```

Manifests live in version control. A central `modules/registry.ts` exports the array. Adding a Module = adding one file + a registry entry.

### 4.2 New: Product manifest (code, not DB)

```ts
// products/saloon-booking.ts
export const saloonBooking = {
  key: 'saloon-booking',
  label: 'Booking Site / System',
  modules: [
    { module: 'login',    side: 'both' },
    { module: 'booking',  side: 'both' },
    { module: 'payments', side: 'both' },
    { module: 'rewards',  side: 'both' },
  ],
} as const;
```

Same pattern: registry export, version control.

### 4.3 Canonical Data Buckets

A fixed enum, sourced from PDF Step 2 minus `owner` (see note):

```ts
export type DataBucket = 'business' | 'employees' | 'customers' | 'products';
```

`owner` is intentionally NOT a Module-permission Data Bucket. Owner data lives on the Primary user_node and the Client record itself; "can edit owner" is implicit (you either are Primary or you aren't). Modeling it as a permissionable bucket would create a contradictory cell — "let Secondary edit owner data" — that the system must always deny. Cleaner to omit.

Adding a new abstract Data Bucket is a typed code change — intentional friction, since each Data Bucket implies real scoping rules (see §6).

### 4.4 New table: `client_enabled_products`

```sql
CREATE TABLE public.client_enabled_products (
  client_id   UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  product_key TEXT NOT NULL,
  enabled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled_by_admin UUID REFERENCES public.admins(id),
  PRIMARY KEY (client_id, product_key)
);
```

Migration `020_client_enabled_products.sql`.

### 4.5 New column on `client_levels`: `permissions JSONB`

```sql
ALTER TABLE public.client_levels
  ADD COLUMN permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
```

Migration `021_client_levels_permissions.sql`.

Shape:

```json
{
  "booking.customers.view":   true,
  "booking.customers.create": true,
  "booking.customers.edit":   false,
  "_platform.users.view":     true,
  "_platform.users.edit":     true,
  "_platform.structure.view": false
}
```

Keys are `<scope>.<bucket-or-surface>.<verb>` where `<scope>` is a Module key (e.g. `booking`) or the literal `_platform` namespace for surfaces that don't belong to a Module (see §4.7). Missing keys default to `false`. The Primary's Level row is conceptually always all-true; we enforce this in middleware rather than persisting a full matrix for Level 1.

**Why JSONB and not a normalized `(level_id, key, allowed)` table:**

- The matrix is sparse — most cells are false by default; JSONB only stores explicit grants.
- Module manifests change shape over time; JSONB shrugs, normalized schema would need migrations.
- All reads are "give me the whole matrix for this Level"; we never query "who has permission X."

### 4.6 New column on `client_roles`: `bucket_family`

```sql
ALTER TABLE public.client_roles
  ADD COLUMN bucket_family TEXT;
-- CHECK constraint enforces it matches DataBucket enum at insert.
```

Migration `022_client_roles_bucket_family.sql`.

Optional. NULL means "this Role does not map to a Data Bucket; assume `employees` for scope purposes." Set by the Primary in the existing Configure → Roles page via a single dropdown next to each Role.

This is the **one and only** place the permission system writes to AMS-owned schema. Without this column the system still functions (default `employees`); with it, Clients with non-standard Role naming can map their Roles to abstract Data Buckets correctly.

### 4.7 Platform surfaces

Three permission groups don't belong to any Module:

| Surface key          | What it gates                                                            |
| -------------------- | ------------------------------------------------------------------------ |
| `_platform.users`    | Add / edit / delete users in this Level's subtree.                       |
| `_platform.structure`| Edit Roles, Levels, cardinality rules (org-wide).                        |
| `_platform.settings` | Settings, backups, team-member admin.                                    |

Each has the same four CRUD verbs (some are effectively no-ops, e.g. `_platform.settings.create` may not map to anything; the UI hides verbs the surface doesn't expose).

## 5. UI surfaces

### 5.1 Admin: "Products" section per Client

Per PDF page 2 ("Products section visible only as admin for clients"). Reachable from the Admin's view of a Client. A list of Products with a checkbox each. Saves to `client_enabled_products`.

### 5.2 Primary: Access Level Dashboard

Reachable from the Client Dashboard's Users area (PDF page 2). One card per Level (excluding Primary, which is read-only "Full access"). Each card contains two grids:

**Modules grid** — auto-generated from `enabled_products × modules × data_buckets`. Rows are `(Module, Data Bucket)` pairs; columns are the Module's declared verbs.

**Platform grid** — fixed: Users / Structure / Settings × applicable verbs.

UI rules:

- Toggling a Module's `view` cell off greys out (but does not auto-clear) the other verbs in that row. Server is the source of truth; UI is a safety rail.
- A "Reset to defaults" button per Level returns the matrix to `{}` (all-false).
- A bulk "All on" / "All off" per row.

### 5.3 Save semantics

Saving writes the full new matrix via `PUT /api/client-levels-permissions?id=<level_id>` — the JSONB is **replaced**, not merged. Server validates each key against the active Module manifests for this Client + the DataBucket enum + the platform surface list, and rejects unknown keys. Consequences:

- Disabling a Product and later re-enabling it does NOT restore prior grants — the Primary reconfigures. v1 simplicity over the small UX win.
- Stranded keys from Modules removed from code can't be re-written (validator blocks them); they sit as harmless JSONB cruft until cleaned by a one-shot migration if desired.
- The `_platform.*` keys are always valid (the surface list is fixed).

## 6. Server enforcement

### 6.1 Permission key

```ts
type PermissionKey =
  | `${ModuleKey}.${DataBucket}.${Verb}`
  | `_platform.${PlatformSurface}.${Verb}`;
```

### 6.2 Middleware

```ts
// netlify/functions/_shared/permissions.ts
export async function requirePermission(req: Request, key: PermissionKey) {
  const session = await getAnySession(req);          // admin OR bucket-user
  if (session.kind === 'admin') return session;       // admin bypass
  const matrix = await getLevelMatrix(session.client_id, session.level_number);
  if (session.level_number === 1) return session;     // Primary bypass
  if (!matrix[key]) throw new ForbiddenError(key);
  return session;
}
```

Cache `(client_id, level_number) → matrix` per request. Invalidate on `PUT /api/client-levels-permissions`.

### 6.3 Scope enforcement (subtree vs org-wide)

| Data Bucket | Scope    | Rule                                                                |
| ----------- | -------- | ------------------------------------------------------------------- |
| `customers` | Subtree  | Filter to user_nodes in caller's subtree via parent_id walk.        |
| `employees` | Subtree  | Same.                                                               |
| `products`  | Org-wide | No filter.                                                          |
| `business`  | Org-wide | No filter.                                                          |

Subtree filtering is implemented by a shared helper `subtreeOf(sql, user_node_id) → user_node_id[]` used in WHERE clauses. The middleware decorates the session with the scope rule so endpoints don't need to special-case.

### 6.4 Endpoint adoption strategy

Existing endpoints (e.g. `/api/user-nodes`, `/api/user-node-credential`) continue to use `requireAdmin` for the Admin path. Bucket-user paths gain `requirePermission(key)`. The retrofit happens Module-by-Module, starting with whichever Module the user wants first (likely `_platform.users.*` since that gates the existing AMS UI).

## 7. Customer-side handling

Customers are not in the Levels tree and not subject to per-Level permissions. The customer-facing UI is generated from the active Products' `customer_side: true` Modules. Customer access is binary (the Product is enabled or not) and uniform across all Customers of that Client.

The PDF's "Customer Dashboard" surface (page 3) is therefore unaffected by this design — it reads the same `client_enabled_products` table that the Admin writes, but ignores the per-Level matrix entirely.

## 8. AMS preservation guarantees

The following AMS feature surfaces are **untouched** by this design:

- `client_roles` table — only `bucket_family` is added; existing columns and behavior unchanged.
- `client_levels` table — only `permissions` JSONB column is added.
- `user_nodes` table, including parent_id tree, level_number, role_id.
- `user_node_credentials` table — completely orthogonal.
- Cardinality rules + the `client_cardinality_rules` table.
- The existing Configure page (Roles + Levels + Cardinality) gains one optional dropdown per Role (the `bucket_family`).
- The existing Access Dashboard (chip view, drag-and-drop, narrowing) — no changes.
- Onboarding flow — gains an optional final step ("Enable Products" + "Configure permissions") but neither is required for the AMS itself to function.

## 9. Migrations summary

| # | File                                          | Change                                                          |
| - | --------------------------------------------- | --------------------------------------------------------------- |
| 020 | `020_client_enabled_products.sql`           | Create table.                                                   |
| 021 | `021_client_levels_permissions.sql`         | Add `permissions JSONB NOT NULL DEFAULT '{}'`.                  |
| 022 | `022_client_roles_bucket_family.sql`        | Add `bucket_family TEXT NULL` with CHECK constraint.            |

Apply to dev Neon via `npm run migrate`, then prod Neon via the standing prod-promotion process before deploying code that depends on these.

## 10. Testing

- **Unit / contract:** Module manifest schema validation, Product manifest validation, registry uniqueness.
- **Integration:** per-Module endpoint suite verifying `requirePermission` accepts/denies based on a seeded matrix; subtree scoping returns only descendants; Primary bypass; admin bypass.
- **Migration:** new columns/tables apply cleanly to a snapshot of prod and existing rows continue to read.
- **UI:** the Access Level Dashboard renders the right rows for a Client with two enabled Products and zero with no Products enabled.

## 11. Out of scope / explicit deferrals

- Per-user permission overrides on top of Levels.
- Time-bounded grants.
- Audit log of permission decisions.
- Granting permissions to Roles independent of Level.
- Module / Product CRUD UI for Admin (manifests stay code-only).
- Self-serve Product enablement by Clients (Admin-only for v1).

## 12. Open questions

None currently. The `role.bucket_family` placement, JSONB-on-Level storage, and dynamic-matrix derivation were all confirmed in brainstorm. Any remaining ambiguity surfaces during writing-plans review.

---

## Glossary

- **AMS** — Access Management System. The Roles + Levels + user_nodes tree this app already ships.
- **Level** — numbered hierarchy depth in the user tree (1 = Primary, 2 = Secondary, ...). Editable label per Client.
- **Role** — categorical user type per Client (Owner, Doctor, Nurse, Patient, ...). Has color, label, custom fields, optional `bucket_family`.
- **Data Bucket** — abstract record-type category (employees / customers / products / business / owner). Drives scope rules.
- **Module** — a functional capability block (Booking, Payments, Carting, ...). Declares which Data Buckets it touches.
- **Product** — a composition of Modules (Saloon Booking, Ecommerce, ...). Admin enables Products per Client.
- **Permission key** — `<module>.<bucket>.<verb>` or `_platform.<surface>.<verb>`. The unit of authorization.
- **Permission matrix** — the JSONB on a Level containing its set of true keys.

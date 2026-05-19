# ADR 0003: Tenancy, Roles, Admin Access, and Impersonation

- **Status:** Accepted
- **Date:** 2026-05-19

## Context

The brief specified an Admin who can fully control all Clients, onboards them, can impersonate any user, and has a "Client-specific Key-Password" gate. Multi-tenant data isolation, the role matrix inside each Workspace, and the impersonation model needed to be settled together because they share enforcement code paths.

## Decisions

### Tenancy
- Single Neon Postgres database. Every tenant-scoped table has `workspace_id uuid NOT NULL`.
- Postgres Row-Level Security (RLS) policies enforce isolation. Every request opens with `SET app.current_user_id = ...` and `SET app.current_workspace_id = ...`. Policies reference these GUCs.
- Admin bypasses RLS via a `SECURITY DEFINER` function path or a separate `admin_role` Postgres role used only after per-Client key verification.

### Roles
- System role: `admin` (lives in `users.is_admin`, no workspace membership).
- Workspace roles, stored in `workspace_memberships(user_id, workspace_id, role)`:
  - `primary` — full control of the Workspace
  - `manager` — edit products, prices, marketplace listings, stock; no team/settings
  - `storekeeper` — stock count + movement only

### Per-Client access gate
- Each Workspace has a 12-character random `admin_access_key` set at onboarding, shown once to the Primary, rotatable by the Primary at any time. Stored as Argon2id hash, not plaintext.
- Admin must enter the key per Workspace before viewing or impersonating. Successful unlock issues a session claim `unlocked_workspaces: [workspace_id]` valid for 15 minutes; auto-extended on activity.
- Failed attempts: 5 strikes in 10 minutes → 1-hour lockout for that Admin↔Workspace pair, alert email to the Primary.

### Impersonation
- **Model: god mode.** Admin keeps all admin powers while impersonating. Justified by support simplicity; mitigated by the audit log and confirmation prompts.
- Pre-conditions: signed in as Admin **and** Workspace currently unlocked via the per-Client key.
- Required: written reason captured at start (free text, max 500 chars). Stored in the audit log and shown to the Client.
- UI: site-wide pinned banner "Acting as <user> in <workspace> — Exit — Expires <time>".
- Time-box: 30 minutes, auto-expire. Resuming after expiry requires re-entering the per-Client key.
- Destructive actions (delete Workspace, delete all products, mass-delete, irreversible exports) trigger an extra confirmation: *"You are doing this AS <user> — confirm."*
- Attribution:
  - Business data (e.g., `products.updated_by`) records the **impersonated user**.
  - Audit log row records the **real actor** (Admin), the impersonated user, the reason, the action, and the data delta.
- Clients see Admin actions through a dedicated **"Admin Activity"** tab in their Workspace, surfacing the audit log rows tagged with impersonation.

## Consequences

- Audit log becomes a customer-facing product feature, not an internal debugging tool. Must be designed for readability (timestamps in Client's timezone, plain-English action descriptions).
- Every write path must accept an optional `acting_as` user_id and a `real_actor_id`. ORM/data layer should encapsulate this so feature code doesn't have to remember.
- God mode means a compromised Admin Google account compromises every Workspace whose per-Client key has been used recently. The 15-minute unlock window + 30-minute impersonation window narrows this to "Admin's recent activity," not "everything ever." Worth a security audit before launch.
- A reversal to "capped" impersonation in v2 is a permission-function change only; no schema migration needed.

## Alternatives considered

- **Capped "act as" mode** — Industry standard (Stripe, Salesforce, Linear, Notion). Cleaner audit, fewer surprises. Rejected here because the Admin/operator workload is intentionally heavy and the operator wants impersonation to feel frictionless.
- **Database-per-tenant** — Stronger isolation but costs ~$19/mo per Client beyond Neon free tier, and makes admin impersonation operationally awkward (live connection swap).
- **No per-Client key gate** — Simpler but leaves a compromised Admin account as a single point of total failure.

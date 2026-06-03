# Access Levels

Per-Level CRUD permissions over (Module, DataBucket) and (_platform, surface), stored as JSONB on `client_levels.permissions`. Primary (L1) is implicit all-on. Admin configures Products per Client; the Client's Primary configures permissions per level. Server enforcement via `requirePermission(req, key)` in `netlify/functions/_shared/permissions.ts`. Endpoint retrofit is gradual — each Module's endpoints adopt the middleware as that Module is implemented.

See:
- Spec: [docs/superpowers/specs/2026-06-01-access-levels-design.md](./superpowers/specs/2026-06-01-access-levels-design.md)
- Plan: [docs/superpowers/plans/2026-06-01-access-levels.md](./superpowers/plans/2026-06-01-access-levels.md)

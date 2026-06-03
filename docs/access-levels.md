# Access Levels

Per-Level CRUD permissions over (Module, DataBucket) and (_platform, surface), stored as JSONB on `client_levels.permissions`. Primary (L1) is implicit all-on. Admin configures Products per Client; the Client's Primary configures permissions per level. Server enforcement via `requirePermission(req, key)` in `netlify/functions/_shared/permissions.ts`. Endpoint retrofit is gradual — each Module's endpoints adopt the middleware as that Module is implemented.

The bucket-user dashboard consumes the matrix client-side: `/api/u-me` returns `permissions` (the flat key map for the user's level) and `enabled_modules`, which `useNavItems` turns into the visible nav rail (L1 sees every enabled Module; L2+ sees Modules with at least one `<key>.<bucket>.view` permission). The client-side filter is UX, not a security boundary — every real Module endpoint must still call `requirePermission(req, '<module>.<bucket>.<verb>')`.

See:
- Access-levels spec: [docs/superpowers/specs/2026-06-01-access-levels-design.md](./superpowers/specs/2026-06-01-access-levels-design.md)
- Access-levels plan: [docs/superpowers/plans/2026-06-01-access-levels.md](./superpowers/plans/2026-06-01-access-levels.md)
- Dashboard spec: [docs/superpowers/specs/2026-06-03-user-dashboard-design.md](./superpowers/specs/2026-06-03-user-dashboard-design.md)
- Dashboard plan: [docs/superpowers/plans/2026-06-03-user-dashboard.md](./superpowers/plans/2026-06-03-user-dashboard.md)

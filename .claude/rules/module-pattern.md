# The canonical module pattern

Every feature module follows the same shape. Reference implementations: **inventory** (complete),
**products** (`shared/` layer), **booking/pos** (authz + RouteMount gates). The live conformance
matrix is `docs/reference/CONFORMANCE.md`; regenerate reference docs with `npm run docs:reference`.

## Required pieces (a module missing any of these is broken in a specific, known way)

1. **ModuleManifest** — `src/modules/registry/manifests/<key>.ts`, registered in
   `registry/modules.ts`. Declares `data_buckets` × `verbs` (that IS the permission surface),
   `vendor_side`/`customer_side`, and nav (see #6).
2. **ProductManifest** — an entry in `registry/products-list/` carrying the module
   (`modules: [{ module: '<key>', side: ... }]`). A ModuleManifest without a product entry is
   INVISIBLE: keys won't validate, nav won't render (iron rule 4). A module may ride an existing
   product (email rides pos + saloon-booking; project-service rides workforce).
3. **Server authz** — `netlify/functions/_<key>-authz.ts` exporting `require<Key>(req, required)`.
   Copy `_inventory-authz.ts`. The order is LAW (iron rule 2):
   1. `requireBucketUser` (401 on no session)
   2. **enable-gate** — module reachable from an enabled product, else `412 <key>_module_not_enabled`
   3. **L1 Owner bypass** — `if (levelNumber === 1)` return ctx with the FULL `<key>.*` perm set
   4. matrix check for everyone else (403 on missing key)
   Strict matrix-only checks blank out the Owner's UI — this has shipped broken twice (POS, Booking).
4. **RouteMount** — `src/modules/<key>/<Key>RouteMounts.tsx` mirroring the same order client-side:
   loading → null; no user → login redirect; module not enabled → workspace redirect; no view perm
   → workspace redirect; Owner (`level_number === 1 || == null`) gets the full perm set.
   Mounted in `src/lib/router.tsx`.
5. **shared/ layer** — `src/modules/<key>/shared/{types.ts,api.ts,permissions.ts}`. The fetch
   wrappers and wire types live here, NOT at module root and NOT inline in components.
   `shared/permissions.ts` holds the module's perm-key list (see `finance/shared/permissions.ts`,
   imported by BOTH the RouteMount and the server authz — one list, two consumers).
6. **Nav** — in the manifest, NOT in components: `hasDedicatedNav: true` + `navLinks: [{ path,
   label, viewKeys, order }]`. Sidebar.tsx renders links from the registry; useNavItems.ts uses the
   same flag to keep the module out of the generic `/m/:key` rail. Set `hasDedicatedNav` even for
   surface-less modules (catalog, data-collection) or the rail renders a dead ModuleStub
   (iron rule 10 — recurred 5× under the old hand-synced-set design). Pick `order` to slot into the
   existing sequence (10-step gaps).
7. **Namespaced CSS** — `src/modules/<key>/<key>.css`, one class prefix (`.inv-*`, `.mfg-*`,
   `.wf-*`…), consuming ONLY the dark-theme tokens from `src/lib/theme.css` (iron rule 9):
   `--bg-base/-surface/-elevated`, `--text-primary/-secondary/-muted`, `--border-subtle/-default`,
   `--accent`+`--text-on-accent`, `--danger`/`--success`. Never invent vars, never hardcode light
   values. jsdom does not evaluate CSS vars, so tests stay green while the UI ships white-on-white —
   verify in a REAL browser.
8. **Migration** — see `.claude/rules/migrations.md`. Number comes from the human coordinator.
9. **Permission keys** — bucket×verb ONLY: `<key>.<bucket>.<verb>` over the manifest's declared
   buckets (iron rule 3). POS's `pos.<action>` keys are FROZEN legacy; never add new
   action-namespaced keys — the validator and the Access Levels UI won't render them.

## Known intentional deviations (don't "fix" these casually)

- **analytics, supply-chain**: no 412 enable-gate in authz (permission-check only) — logged debt in
  CONFORMANCE.md; changing it changes HTTP behavior.
- **products, catalog**: platform-level auth (`_shared/permissions.ts` / inline pub gate) instead of
  a dedicated authz file — oldest surfaces, working, high blast radius.
- **payments**: registry-only stub. No dir, no authz, no routes.
- **Product Manager sidebar link** renders without an enablement check (`skipEnableCheck` on its
  navLink) — preserved legacy quirk.

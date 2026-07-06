---
description: Paved-road checklist for scaffolding a new ExSol module
---

Scaffold a new module named $ARGUMENTS following the canonical pattern
(`.claude/rules/module-pattern.md`; reference implementation: inventory).

Work through this checklist IN ORDER, showing progress as you go:

1. **Read the rules first**: `.claude/rules/module-pattern.md`, `.claude/rules/migrations.md`,
   and skim `docs/reference/CONFORMANCE.md` for the current landscape.
2. **Migration**: draft `db/migrations/<NUMBER>_<key>.sql` — STOP and ask the human coordinator
   for the number (iron rule 1). One statement per line; comments on their own line.
3. **ModuleManifest**: `src/modules/registry/manifests/<key>.ts` — buckets, verbs, sides,
   `hasDedicatedNav: true`, `navLinks` (pick an `order` slotting into the existing sequence;
   see other manifests). Register in `registry/modules.ts`.
4. **ProductManifest**: entry in `registry/products-list/` carrying the module (or add it to an
   existing product). Without this the module is invisible (iron rule 4).
5. **Server authz**: `netlify/functions/_<key>-authz.ts` copied from `_inventory-authz.ts`:
   requireBucketUser → 412 enable-gate → `levelNumber === 1` full-perm bypass → matrix check.
6. **Endpoints**: flat `netlify/functions/<key>-*.ts` files. Set `config.path`; if two share a
   path, BOTH set `config.method` (iron rule 5). Remember: `/api/foo/:id` routes to `foo.ts`
   by NAME.
7. **shared/ layer**: `src/modules/<key>/shared/{types.ts,api.ts,permissions.ts}` — wire types,
   fetch wrappers, and the perm-key list (import the list in BOTH the authz file and the
   RouteMount, like finance).
8. **RouteMount**: `src/modules/<key>/<Key>RouteMounts.tsx` (copy inventory's gate order), mounted
   in `src/lib/router.tsx`.
9. **CSS**: `src/modules/<key>/<key>.css`, single `.<abbrev>-*` prefix, theme.css tokens ONLY
   (iron rule 9).
10. **Seed script** (optional): `scripts/seed-<key>.ts` + package.json `seed:<key>` entry.
11. **Tests**: integration tests for every endpoint (randomized unique literals; `getStore()`
    mocked if Blobs are touched) + RouteMount/nav unit tests.
12. **Verify**: `npm run typecheck` + FULL `npm test` green; `npm run docs:reference` and commit
    the regenerated docs with the module.
13. **Reality check in a real browser** (dark theme, sidebar link, Owner + L2 matrix cases —
    jsdom can't catch iron rules 2/9/10 violations).

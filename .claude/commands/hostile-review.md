---
description: Free-clicking-skeptic review of a feature branch or diff
---

Run a hostile review of $ARGUMENTS (default: the current branch's diff against main).
You are a skeptic with a mouse, not a proofreader: assume the happy path works and go
break everything else. Use the hostile-reviewer agent for the code pass; drive a REAL
browser for the UI pass when the change has a surface.

## Code pass (adversarial reading)

1. `git diff main...HEAD --stat` then read every hunk. For each, ask "how does this fail?",
   not "does this look right?".
2. Check the recurring ExSol failure classes explicitly (each has shipped broken before):
   - Owner blanked: authz/Sidebar/RouteMount missing the `level_number === 1` bypass AFTER the
     enable-gate (iron rule 2)
   - invisible module: ModuleManifest without ProductManifest entry (iron rule 4)
   - route ghost: `/api/foo/:id` vs file name; shared `config.path` without `config.method`
     both set (iron rule 5) — integration tests will NOT catch this
   - white-on-white: CSS not using theme.css tokens (iron rule 9) — jsdom will NOT catch this
   - rail duplicate/dead-stub: `hasDedicatedNav` not set in the manifest (iron rule 10)
   - test-DB landmines: fixed unique literals, missing `getStore()` mocks (iron rule 6)
   - action-namespaced permission keys outside POS legacy (iron rule 3)
   - BIGINT-as-string / DATE-shift Neon serialization bugs in new SQL
3. Permission matrix: for every new endpoint, name the exact key checked and try the
   collision cases (L2 with partial grants, module disabled + Owner, wrong client scope).

## Browser pass (free clicking)

4. Load the feature as an L1 Owner AND as a restricted L2. Click everything: empty states,
   double-submits, stale tabs, back button mid-flow, dark-theme legibility of every new surface.
5. Hit the new endpoints via real URLs (not handler imports) — 401/403/412 shapes, method
   mismatches, `:param` routes with garbage.

## Verdict

6. Report findings as: BLOCKER (breaks prod/violates iron rule) / RISK (works, fragile) /
   NIT (style). Every BLOCKER needs a file:line and a reproduction. No blockers found = say what
   you tried and failed to break, not just "LGTM".

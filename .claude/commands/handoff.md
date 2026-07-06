---
description: Emit the house "Work done." handoff for the Main integration chat
---

The work in this session is complete and committed. Emit the house handoff so the human can paste
it into the Main integration chat. Requirements:

1. Verify first — do not emit a handoff over a dirty tree or red suite:
   - `git status` clean, `git branch --show-current` correct
   - state the HEAD SHA (`git log --oneline -1`)
   - `npm run typecheck` + FULL `npm test` both green (say the numbers)
2. Then end your reply with a single self-contained block in EXACTLY this shape:

```
Work done. <one-paragraph summary of what shipped>

Worktree: <absolute path>
Branch: <branch> @ <short SHA>
Commits (by theme):
- <sha> <subject>
- ...

Verification: typecheck green; vitest <N>/<N> green<; other evidence — netlify build, browser check, …>

Gotchas / risk notes:
- <anything the merger must know: behavior-adjacent changes, deferred debt, files sibling
  chats may be touching, migration dependencies + numbering needs, docs to regenerate
  (npm run docs:reference) if endpoints/manifests/migrations changed in the merge>

Suggested next prompt for the Main chat:
<a paste-and-go prompt: what to review, in which order, what to cherry-pick/merge, what to
run before pushing (typecheck + full suite + docs:reference), and what NOT to do (no push
without the human's say-so)>
```

The block must be self-contained — the Main chat has NONE of this session's context.

# Migration rules

Forward-only numbered SQL files in `db/migrations/`. `npm run migrate` applies ALL pending
migrations against whatever `DATABASE_URL` the env points at. Table inventory:
`docs/reference/schema.md` (`npm run docs:reference`).

## Iron rule 1 — numbering

Migration numbers are allocated by the HUMAN COORDINATOR. Never pick your own; parallel worktrees
have prefix-collided before (043–045). Ask, then name the file `<number>_<snake_case>.sql`.

## Format (the splitter is dumb on purpose)

`scripts/migrate.ts` splits on `;` at end-of-line only:

- ONE SQL statement per line.
- Comments on their OWN line — a comment after a `;` merges two statements into one and Postgres
  throws `42601`.

## Dev vs prod are separate Neon branches

- `npm run migrate` on your `.env` touches DEV. Prod needs the same command with the prod URL —
  BEFORE promoting code that depends on the new schema (additive case).
- **Destructive migrations invert the order** (DROP COLUMN/TABLE): deploy the code that stops
  using the column FIRST, then run the migration on prod. Remember `npm run migrate` applies all
  pending files, not just the latest — check `npm run migrate:status`.
- Before ANY destructive psql/migration, echo the endpoint host (`ep-<id>…`) and confirm which
  branch it is. Same hostname == same branch regardless of what the env var is named.

## Content conventions

- Tables are `public.*`, snake_case, module-prefixed (`finance_expenses`, `workforce_shifts`).
- `updated_at` maintained via the shared `set_updated_at` trigger function (migration 005).
- FKs: think about ON DELETE at creation time — `audit_log.actor_user_node` has NO cascade and
  deleting creator nodes trips 23503 (known debt, migration sketch exists).
- Never edit an applied migration; fix forward with a new one.

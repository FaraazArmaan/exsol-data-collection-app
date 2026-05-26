#!/usr/bin/env tsx
import { neon, NeonQueryPromise } from '@neondatabase/serverless';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function ensureMigrationsTable(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function applied(sql: ReturnType<typeof neon>): Promise<Set<string>> {
  const rows = await sql<{ version: string }[]>`SELECT version FROM public.schema_migrations`;
  return new Set(rows.map((r) => r.version));
}

// Split a migration file body into individual SQL statements.
// Naive split on terminal-semicolon-at-end-of-line — sufficient for migrations
// 001–004 which are clean DDL with no $$-quoted bodies or semicolon-in-string
// literals. Revisit if future migrations need PL/pgSQL functions.
function splitStatements(body: string): string[] {
  return body
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);
  await ensureMigrationsTable(sql);
  const done = await applied(sql);

  const statusOnly = process.argv.includes('--status');
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) {
      console.log(`✓ ${version} (already applied)`);
      continue;
    }
    if (statusOnly) {
      console.log(`… ${version} (pending)`);
      continue;
    }
    const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = splitStatements(body);
    console.log(`→ applying ${version} (${statements.length} statement${statements.length === 1 ? '' : 's'})`);
    // @neondatabase/serverless v0.10 has no sql.unsafe(); use transaction() for atomicity.
    // The cast is needed because the ordinary-function form of sql() returns
    // NeonQueryPromise<...> which TS does not infer as the transaction array
    // element type without help.
    await sql.transaction(statements.map((stmt) => sql(stmt)) as NeonQueryPromise<boolean, boolean, unknown>[]);
    await sql`INSERT INTO public.schema_migrations (version) VALUES (${version})`;
    console.log(`✓ ${version}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

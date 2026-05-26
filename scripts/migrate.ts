#!/usr/bin/env tsx
import { neon, type NeonQueryFunction, type NeonQueryPromise } from '@neondatabase/serverless';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

type SQL = NeonQueryFunction<false, false>;

async function ensureMigrationsTable(sql: SQL) {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function applied(sql: SQL): Promise<Set<string>> {
  const rows = (await sql`SELECT version FROM public.schema_migrations`) as { version: string }[];
  return new Set(rows.map((r) => r.version));
}

// Split a migration file body into individual SQL statements.
// Naive split on terminal-semicolon-at-end-of-line. Cannot safely tokenize
// $$-quoted PL/pgSQL bodies (the inner ; would be split as a statement
// boundary). Convention: a migration file containing $$ must be a single
// statement — we detect $$ and skip splitting, passing the whole body
// through. Multi-statement files that need PL/pgSQL must be split across
// numbered files (e.g., 005_function.sql + 006_trigger.sql).
function splitStatements(body: string): string[] {
  const trimmed = body.trim();
  if (trimmed.includes('$$')) {
    return [trimmed];
  }
  return trimmed
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
    // The dynamic-string sql(stmt) overload infers NeonQueryPromise<boolean, boolean>
    // (widened generics from the optional overrides), while transaction() demands
    // the <false, false> form returned by neon(url) with default options. Runtime
    // types match — this cast just makes TS see through the overload widening.
    const queries = statements.map((stmt) => sql(stmt)) as unknown as NeonQueryPromise<false, false>[];
    await sql.transaction(queries);
    await sql`INSERT INTO public.schema_migrations (version) VALUES (${version})`;
    console.log(`✓ ${version}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

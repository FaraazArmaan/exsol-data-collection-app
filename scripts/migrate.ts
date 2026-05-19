import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from '@neondatabase/serverless';

const url = process.env.NEON_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('Set NEON_DATABASE_URL (or TEST_DATABASE_URL) to run migrations.');
  process.exit(1);
}

const statusOnly = process.argv.includes('--status');
const pool = new Pool({ connectionString: url });

async function ensureMigrationsTable(c: any) {
  await c.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedSet(c: any): Promise<Set<string>> {
  const r = await c.query(`SELECT filename FROM _migrations`);
  return new Set(r.rows.map((row: any) => row.filename as string));
}

async function run() {
  const dir = resolve('db/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const c = await pool.connect();
  try {
    await ensureMigrationsTable(c);
    const applied = await appliedSet(c);

    if (statusOnly) {
      for (const f of files) {
        console.log(`${applied.has(f) ? 'APPLIED' : 'PENDING'}  ${f}`);
      }
      return;
    }

    for (const f of files) {
      if (applied.has(f)) {
        console.log(`SKIP   ${f}`);
        continue;
      }
      const sql = readFileSync(join(dir, f), 'utf8');
      console.log(`APPLY  ${f}`);
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query(`INSERT INTO _migrations (filename) VALUES ($1)`, [f]);
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        console.error(`FAIL   ${f}`);
        throw err;
      }
    }
    console.log('Done.');
  } finally {
    c.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

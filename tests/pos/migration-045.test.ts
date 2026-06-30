import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

describe('migration 045 — sales.source + nullable creator', () => {
  it('makes created_by_user_node nullable', async () => {
    const rows = (await sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sales'
        AND column_name = 'created_by_user_node'
    `) as Array<{ is_nullable: string }>;
    expect(rows[0]!.is_nullable).toBe('YES');
  });

  it('adds source TEXT NOT NULL default pos', async () => {
    const rows = (await sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'source'
    `) as Array<{ data_type: string; is_nullable: string; column_default: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data_type).toBe('text');
    expect(rows[0]!.is_nullable).toBe('NO');
    expect(rows[0]!.column_default ?? '').toContain('pos');
  });

  it('enforces the source↔creator attribution invariant via a named CHECK', async () => {
    const cons = (await sql`
      SELECT conname FROM pg_constraint WHERE conname = 'sales_source_attribution_consistent'
    `) as Array<{ conname: string }>;
    expect(cons).toHaveLength(1);
  });

  it('indexes (bucket_id, source, created_at)', async () => {
    const idx = (await sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'idx_sales_bucket_source'
    `) as Array<{ indexname: string }>;
    expect(idx).toHaveLength(1);
  });
});

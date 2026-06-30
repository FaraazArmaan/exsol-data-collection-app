import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

describe('migration 043 — clients.storefront_enabled', () => {
  it('adds a boolean storefront_enabled, NOT NULL, default false', async () => {
    const rows = (await sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'clients'
        AND column_name = 'storefront_enabled'
    `) as Array<{ data_type: string; is_nullable: string; column_default: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data_type).toBe('boolean');
    expect(rows[0]!.is_nullable).toBe('NO');
    expect(rows[0]!.column_default ?? '').toContain('false');
  });
});

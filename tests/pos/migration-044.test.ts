import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

describe('migration 044 — products.storefront_visible', () => {
  it('adds a boolean storefront_visible, NOT NULL, default true', async () => {
    const rows = (await sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name = 'storefront_visible'
    `) as Array<{ data_type: string; is_nullable: string; column_default: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data_type).toBe('boolean');
    expect(rows[0]!.is_nullable).toBe('NO');
    expect(rows[0]!.column_default ?? '').toContain('true');
  });

  it('creates the partial index for storefront-visible active products', async () => {
    const idx = (await sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'idx_products_client_storefront_visible'
    `) as Array<{ indexdef: string }>;
    expect(idx).toHaveLength(1);
    expect(idx[0]!.indexdef.toLowerCase()).toContain('where');
  });
});

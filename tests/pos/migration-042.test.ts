import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

describe('migration 042 — enable pos product', () => {
  it('every client with products enabled also has pos enabled', async () => {
    const mismatched = await sql`
      SELECT c.client_id
      FROM public.client_enabled_products c
      WHERE c.product_key = 'products'
        AND NOT EXISTS (
          SELECT 1 FROM public.client_enabled_products c2
          WHERE c2.client_id = c.client_id AND c2.product_key = 'pos'
        )
    ` as Array<{ client_id: string }>;
    expect(mismatched).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

describe('migration 041 — sale_lines table', () => {
  it('has cascade delete from sales and restrict from products', async () => {
    const fks = await sql`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conrelid = 'public.sale_lines'::regclass AND contype = 'f'
    ` as Array<{ conname: string; confdeltype: string }>;
    // confdeltype: 'c' = CASCADE, 'r' = RESTRICT.
    // FK names follow the default PG pattern `sale_lines_<col>_fkey`,
    // so match on the column name to disambiguate (both contain "sale").
    const saleFk    = fks.find(f => f.conname.toLowerCase().includes('sale_id'));
    const productFk = fks.find(f => f.conname.toLowerCase().includes('product_id'));
    expect(saleFk?.confdeltype).toBe('c');
    expect(productFk?.confdeltype).toBe('r');
  });
  it('rejects qty <= 0', async () => {
    await expect(sql`
      INSERT INTO public.sale_lines (sale_id, product_id, product_name_snap,
        unit_price_cents, qty, line_total_cents, position)
      VALUES (gen_random_uuid(), gen_random_uuid(), 'X', 100, 0, 0, 0)
    `).rejects.toThrow();
  });
  it('rejects line_total != unit_price * qty', async () => {
    await expect(sql`
      INSERT INTO public.sale_lines (sale_id, product_id, product_name_snap,
        unit_price_cents, qty, line_total_cents, position)
      VALUES (gen_random_uuid(), gen_random_uuid(), 'X', 100, 2, 999, 0)
    `).rejects.toThrow(/sale_lines_total_matches/);
  });
});

import { describe, it, expect } from 'vitest';
import { db } from '../../netlify/functions/_shared/db';

describe('migration 040 — sales table', () => {
  it('has the expected columns and constraints', async () => {
    const sql = db();
    const cols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sales'
      ORDER BY ordinal_position
    ` as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    const names = cols.map(c => c.column_name);
    for (const expected of [
      'id', 'bucket_id', 'order_no', 'status', 'channel',
      'customer_name', 'customer_phone', 'customer_email',
      'subtotal_cents', 'discount_cents', 'tax_cents', 'total_cents',
      'created_by_user_node', 'created_at',
      'paid_at', 'fulfilled_at', 'cancelled_at', 'refunded_at',
      'payment_method', 'payment_ref',
    ]) expect(names).toContain(expected);
  });
  it('rejects empty customer_phone', async () => {
    const sql = db();
    await expect(sql`
      INSERT INTO public.sales
        (bucket_id, order_no, channel, customer_name, customer_phone,
         subtotal_cents, total_cents, created_by_user_node)
      VALUES
        (gen_random_uuid(), 1, 'instore', 'X', '   ', 0, 0, gen_random_uuid())
    `).rejects.toThrow(/sales_phone_not_empty/);
  });
});

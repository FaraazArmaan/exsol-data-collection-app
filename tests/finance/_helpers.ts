// Integration-test helpers for /api/finance/* endpoints.
//
// Reuses the POS harness (seedClientWithProductsEnabled mints a Client + L1
// Owner + bucket-user cookie) and layers on finance-specific fixtures:
//   • enable the `finance` product,
//   • insert paid sales (revenue) so the P&L has something to sum.
// Shared persistent dev DB, no teardown → every seed uses unique literals.

import { neon } from '@neondatabase/serverless';
import {
  seedClientWithProductsEnabled, type PosTestCtx,
} from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

export type { PosTestCtx };
export {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser,
  makeBucketUserRequest,
} from '../pos/_helpers';

// A Client with the finance module enabled + an L1 Owner cookie.
export async function seedFinanceClient(): Promise<PosTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'finance', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
  return ctx;
}

export interface PaidSaleOpts {
  source: 'pos' | 'storefront';
  channel?: 'instore' | 'online' | 'pickup';
  totalCents: number;
  status?: 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
  createdAt?: string; // ISO; defaults to now()
}

// Inserts a sale scoped to the client. order_no is derived from MAX+1 to satisfy
// the per-bucket unique constraint without cross-test coordination.
export async function insertSale(
  clientId: string, createdByNode: string, opts: PaidSaleOpts,
): Promise<string> {
  const mx = (await sql`
    SELECT COALESCE(MAX(order_no), 0)::int AS mx FROM public.sales WHERE bucket_id = ${clientId}::uuid
  `) as Array<{ mx: number }>;
  const orderNo = mx[0]!.mx + 1;
  const channel = opts.channel ?? 'instore';
  const status = opts.status ?? 'paid';
  // CHECK sales_source_attribution_consistent (mig 045): pos ⇒ creator node set,
  // storefront ⇒ creator node NULL (guest checkout).
  const creator = opts.source === 'storefront' ? null : createdByNode;
  const rows = (await sql`
    INSERT INTO public.sales
      (bucket_id, order_no, status, channel, customer_name, customer_phone,
       subtotal_cents, discount_cents, tax_cents, total_cents,
       created_by_user_node, source, created_at)
    VALUES
      (${clientId}::uuid, ${orderNo}, ${status}::public.sale_status, ${channel}::public.sale_channel,
       'Test Customer', '+919000000000',
       ${opts.totalCents}, 0, 0, ${opts.totalCents},
       ${creator}::uuid, ${opts.source}, COALESCE(${opts.createdAt ?? null}::timestamptz, now()))
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

// Current + prior calendar month as 'YYYY-MM'.
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function priorMonth(): { month: string; firstDayISO: string } {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const month = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
  return { month, firstDayISO: `${month}-05T12:00:00Z` };
}

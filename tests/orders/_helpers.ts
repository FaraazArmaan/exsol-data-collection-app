// Orders test helpers — built on the POS helpers, which mint a Client + L1
// Owner + bucket-user session and enable products+pos. Orders additionally
// needs the 'orders' Product enabled. No teardown (shared dev DB) — every
// seed uses a fresh client.
import { neon } from '@neondatabase/serverless';
import {
  seedClientWithProductsEnabled,
  makeBucketUserRequest,
  seedProducts,
  type PosTestCtx,
} from '../pos/_helpers';

export { makeBucketUserRequest, seedProducts };

// Insert (or upsert) an inventory_stock row for a product, scoped to the
// client from ctx. Used by backorder fulfil tests to set up pre-conditions.
export async function seedStock(ctx: PosTestCtx, productId: string, qty: number): Promise<void> {
  await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand)
    VALUES (${ctx.clientId}::uuid, ${productId}::uuid, ${qty})
    ON CONFLICT (client_id, product_id) DO UPDATE SET qty_on_hand = ${qty}, updated_at = now()
  `;
}

const sql = neon(process.env.DATABASE_URL!);

export async function enableOrders(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'orders', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

// Fresh client with products+pos+orders enabled and an L1 Owner session.
export async function seedOrdersClient(): Promise<PosTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await enableOrders(ctx);
  return ctx;
}

export interface SeedSaleInput {
  status?: 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
  channel?: 'instore' | 'online' | 'pickup';
  total?: number; // cents; default 1000
  paid_at?: string | null;
  fulfilled_at?: string | null;
}

export interface SeedSaleResult {
  saleId: string;
}

// Inserts a single sales row for the given client (bucket_id = clientId).
// total_cents must equal subtotal_cents - discount_cents + tax_cents; we keep
// discount/tax at 0 and set subtotal = total to satisfy the CHECK constraint.
export async function seedSale(
  ctx: PosTestCtx,
  opts: SeedSaleInput = {},
): Promise<SeedSaleResult> {
  const status = opts.status ?? 'pending_payment';
  const channel = opts.channel ?? 'instore';
  const total = opts.total ?? 1000;
  const customerName = `Test Customer ${Math.random().toString(36).slice(2, 8)}`;
  const customerPhone = `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`;
  // order_no must be unique per bucket — use a large random number to avoid
  // collisions across concurrent test runs on the shared dev DB.
  const orderNo = Math.floor(100000 + Math.random() * 900000);

  const paidAt = opts.paid_at !== undefined ? opts.paid_at : null;
  const fulfilledAt = opts.fulfilled_at !== undefined ? opts.fulfilled_at : null;

  const rows = (await sql`
    INSERT INTO public.sales
      (bucket_id, order_no, status, channel,
       customer_name, customer_phone,
       subtotal_cents, discount_cents, tax_cents, total_cents,
       created_by_user_node, paid_at, fulfilled_at)
    VALUES
      (${ctx.clientId}::uuid, ${orderNo}, ${status}::sale_status, ${channel}::sale_channel,
       ${customerName}, ${customerPhone},
       ${total}, 0, 0, ${total},
       ${ctx.userNodeId}::uuid, ${paidAt}::timestamptz, ${fulfilledAt}::timestamptz)
    RETURNING id
  `) as Array<{ id: string }>;

  return { saleId: rows[0]!.id };
}

// Procurement test helpers — built on the POS helpers (fresh client + L1 Owner
// + bucket-user session, products+pos enabled). Adds inventory + procurement
// enablement and small readers for assertions. No teardown (shared dev DB); each
// seed uses a fresh client so rows never collide across tests.
import { neon } from '@neondatabase/serverless';
import { seedClientWithProductsEnabled, type PosTestCtx } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

export async function enableProcurement(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'inventory', ${ctx.adminId}), (${ctx.clientId}, 'procurement', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

export async function seedProcurementClient(): Promise<PosTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await enableProcurement(ctx);
  return ctx;
}

export async function seedSupplier(ctx: PosTestCtx, name: string): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.suppliers (client_id, name) VALUES (${ctx.clientId}, ${name}) RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

export async function readStock(ctx: PosTestCtx, productId: string): Promise<number | null> {
  const rows = (await sql`
    SELECT qty_on_hand FROM public.inventory_stock
    WHERE client_id = ${ctx.clientId} AND product_id = ${productId} LIMIT 1
  `) as Array<{ qty_on_hand: number }>;
  return rows[0]?.qty_on_hand ?? null;
}

export async function readPurchaseMovements(
  ctx: PosTestCtx,
  productId: string,
): Promise<Array<{ qty_delta: number; type: string; ref: string | null }>> {
  return (await sql`
    SELECT qty_delta, type, ref FROM public.stock_movements
    WHERE client_id = ${ctx.clientId} AND product_id = ${productId} AND type = 'purchase'
    ORDER BY created_at DESC
  `) as Array<{ qty_delta: number; type: string; ref: string | null }>;
}

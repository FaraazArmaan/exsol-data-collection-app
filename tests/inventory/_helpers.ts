// Inventory test helpers — built on the POS helpers, which mint a Client + L1
// Owner + bucket-user session and enable products+pos. Inventory additionally
// needs the 'inventory' Product enabled and, for the sale hook, the per-client
// tracking flag. No teardown (shared dev DB) — every seed uses a fresh client.
import { neon } from '@neondatabase/serverless';
import { seedClientWithProductsEnabled, type PosTestCtx } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

export async function enableInventory(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'inventory', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

export async function setTrackingFlag(ctx: PosTestCtx, on: boolean): Promise<void> {
  await sql`UPDATE public.clients SET inventory_tracking_enabled = ${on} WHERE id = ${ctx.clientId}`;
}

// Fresh client with products+pos+inventory enabled and an L1 Owner session.
export async function seedInventoryClient(): Promise<PosTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await enableInventory(ctx);
  return ctx;
}

export async function seedStock(
  ctx: PosTestCtx,
  productId: string,
  qtyOnHand: number,
  reorderLevel = 5,
): Promise<void> {
  await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
    VALUES (${ctx.clientId}, ${productId}, ${qtyOnHand}, ${reorderLevel})
    ON CONFLICT (client_id, product_id)
    DO UPDATE SET qty_on_hand = ${qtyOnHand}, reorder_level = ${reorderLevel}
  `;
}

export async function readStock(
  ctx: PosTestCtx,
  productId: string,
): Promise<{ qty_on_hand: number; reorder_level: number } | null> {
  const rows = (await sql`
    SELECT qty_on_hand, reorder_level FROM public.inventory_stock
    WHERE client_id = ${ctx.clientId} AND product_id = ${productId} LIMIT 1
  `) as Array<{ qty_on_hand: number; reorder_level: number }>;
  return rows[0] ?? null;
}

export async function readMovements(
  ctx: PosTestCtx,
  productId: string,
): Promise<Array<{ qty_delta: number; type: string; ref: string | null }>> {
  return (await sql`
    SELECT qty_delta, type, ref FROM public.stock_movements
    WHERE client_id = ${ctx.clientId} AND product_id = ${productId}
    ORDER BY created_at DESC
  `) as Array<{ qty_delta: number; type: string; ref: string | null }>;
}

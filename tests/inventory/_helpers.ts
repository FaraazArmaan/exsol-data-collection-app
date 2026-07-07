// Inventory test helpers — built on the POS helpers, which mint a Client + L1
// Owner + bucket-user session and enable products+pos. Inventory additionally
// needs the 'inventory' Product enabled and, for the sale hook, the per-client
// tracking flag. No teardown (shared dev DB) — every seed uses a fresh client.
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import { seedClientWithProductsEnabled, type PosTestCtx } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

// Seed a costed purchase: a received PO + line (unit cost) + the matching
// 'purchase' stock movement (ref = po:<id>), so the moving-average valuation has
// a cost basis to read. Mirrors what procurement's receive flow produces.
export async function seedPurchaseCost(
  ctx: PosTestCtx,
  productId: string,
  qty: number,
  unitCostCents: number,
): Promise<void> {
  const sup = (await sql`
    INSERT INTO public.suppliers (client_id, name) VALUES (${ctx.clientId}, ${`cost-sup-${randomUUID().slice(0, 8)}`}) RETURNING id
  `) as Array<{ id: string }>;
  const po = (await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status) VALUES (${ctx.clientId}, ${sup[0]!.id}, 'received') RETURNING id
  `) as Array<{ id: string }>;
  await sql`
    INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
    VALUES (${po[0]!.id}, ${productId}, ${qty}, ${unitCostCents})
  `;
  await sql`
    INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref)
    VALUES (${ctx.clientId}, ${productId}, ${qty}, 'purchase', ${`po:${po[0]!.id}`})
  `;
}

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

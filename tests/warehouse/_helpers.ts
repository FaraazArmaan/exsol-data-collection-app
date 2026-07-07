// Warehouse test helpers — built on the POS helpers (mint a Client + L1 Owner +
// bucket-user session, products+pos enabled). Warehouse additionally needs the
// 'inventory' + 'warehouse' Products enabled. No teardown (shared dev DB) — every
// seed uses a fresh client, and location names are randomized to dodge the
// (client_id, name) unique constraint on re-runs.
import { neon } from '@neondatabase/serverless';
import { seedClientWithProductsEnabled, type PosTestCtx } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

export async function enableWarehouse(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'inventory', ${ctx.adminId}),
           (${ctx.clientId}, 'warehouse', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

// Fresh client with products+pos+inventory+warehouse enabled and an L1 Owner session.
export async function seedWarehouseClient(): Promise<PosTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await enableWarehouse(ctx);
  return ctx;
}

export function randName(prefix = 'Loc'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function seedLocation(
  ctx: PosTestCtx,
  name = randName(),
  kind = 'warehouse',
): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.warehouse_locations (client_id, name, kind)
    VALUES (${ctx.clientId}, ${name}, ${kind})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

export async function seedStockAt(
  locationId: string,
  productId: string,
  qty: number,
): Promise<void> {
  await sql`
    INSERT INTO public.stock_by_location (location_id, product_id, qty)
    VALUES (${locationId}, ${productId}, ${qty})
    ON CONFLICT (location_id, product_id) DO UPDATE SET qty = ${qty}
  `;
}

export async function readStockAt(
  locationId: string,
  productId: string,
): Promise<number | null> {
  const rows = (await sql`
    SELECT qty FROM public.stock_by_location
    WHERE location_id = ${locationId} AND product_id = ${productId} LIMIT 1
  `) as Array<{ qty: number }>;
  return rows[0]?.qty ?? null;
}

export async function readTransferMovements(
  ctx: PosTestCtx,
  productId: string,
): Promise<Array<{ qty_delta: number; type: string; ref: string | null }>> {
  return (await sql`
    SELECT qty_delta, type, ref FROM public.stock_movements
    WHERE client_id = ${ctx.clientId} AND product_id = ${productId} AND type = 'transfer'
    ORDER BY qty_delta ASC
  `) as Array<{ qty_delta: number; type: string; ref: string | null }>;
}

// Seeds a supplier + a received purchase order with one item per (product, qty),
// so putaway/ASN tests have a real received PO to consume. Returns the PO id and
// the created item ids (aligned with the input order).
export async function seedReceivedPO(
  ctx: PosTestCtx,
  lines: Array<{ productId: string; qty: number }>,
  status: 'received' | 'ordered' | 'draft' = 'received',
): Promise<{ poId: string; itemIds: string[] }> {
  const sup = (await sql`
    INSERT INTO public.suppliers (client_id, name)
    VALUES (${ctx.clientId}, ${randName('Supplier')})
    RETURNING id
  `) as Array<{ id: string }>;
  const po = (await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status, received_at)
    VALUES (${ctx.clientId}, ${sup[0]!.id}, ${status}::purchase_order_status,
            ${status === 'received' ? new Date().toISOString() : null})
    RETURNING id
  `) as Array<{ id: string }>;
  const poId = po[0]!.id;
  const itemIds: string[] = [];
  for (const l of lines) {
    const it = (await sql`
      INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty)
      VALUES (${poId}, ${l.productId}, ${l.qty})
      RETURNING id
    `) as Array<{ id: string }>;
    itemIds.push(it[0]!.id);
  }
  return { poId, itemIds };
}

export async function readPutawayTasks(
  ctx: PosTestCtx,
): Promise<Array<{ id: string; product_id: string; qty: number; status: string; location_id: string | null }>> {
  return (await sql`
    SELECT id, product_id, qty, status, location_id FROM public.warehouse_putaway_tasks
    WHERE client_id = ${ctx.clientId} ORDER BY created_at ASC
  `) as Array<{ id: string; product_id: string; qty: number; status: string; location_id: string | null }>;
}

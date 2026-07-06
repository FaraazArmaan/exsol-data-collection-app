import { db } from '../../netlify/functions/_shared/db';
import { seedProducts } from '../pos/_helpers';

const sql = db();

export function rand(): string {
  return Math.random().toString(36).slice(2, 7);
}

// Inventory: one below-reorder product, one healthy; movements across the window.
export async function seedInventoryData(
  clientId: string,
): Promise<{ lowProductId: string; okProductId: string }> {
  const [lowId, okId] = await seedProducts(clientId, [
    { name: `LowStock ${rand()}` },
    { name: `OkStock ${rand()}` },
  ]);
  await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
    VALUES (${clientId}::uuid, ${lowId}::uuid, 2, 10),
           (${clientId}::uuid, ${okId}::uuid, 50, 10)
  `;
  await sql`
    INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_at)
    VALUES
      (${clientId}::uuid, ${lowId}::uuid, -5, 'sale',     'demo', now() - interval '2 days'),
      (${clientId}::uuid, ${okId}::uuid,  20, 'purchase', 'demo', now() - interval '2 days'),
      (${clientId}::uuid, ${okId}::uuid,  -3, 'sale',     'demo', now() - interval '10 days')
  `;
  return { lowProductId: lowId!, okProductId: okId! };
}

// Procurement: one 'ordered' PO (qty 10 @ 5000c = 50000c) + one 'received' (must be excluded).
export async function seedProcurementData(clientId: string): Promise<{ orderedPoId: string }> {
  const [pid] = await seedProducts(clientId, [{ name: `PO Product ${rand()}` }]);
  const supplierRows = (await sql`
    INSERT INTO public.suppliers (client_id, name)
    VALUES (${clientId}::uuid, ${`Supplier ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  const supplierId = supplierRows[0]!.id;
  const orderedRows = (await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes)
    VALUES (${clientId}::uuid, ${supplierId}::uuid, 'ordered', (now() + interval '5 days')::date, 'demo')
    RETURNING id
  `) as Array<{ id: string }>;
  const orderedPoId = orderedRows[0]!.id;
  await sql`
    INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
    VALUES (${orderedPoId}::uuid, ${pid}::uuid, 10, 5000)
  `;
  await sql`
    INSERT INTO public.purchase_orders (client_id, supplier_id, status, notes)
    VALUES (${clientId}::uuid, ${supplierId}::uuid, 'received', 'closed')
  `;
  return { orderedPoId };
}

// Manufacturing: one 'in_progress' order (qty 30) + one 'planned' (must be excluded).
export async function seedManufacturingData(clientId: string): Promise<void> {
  const [outProd] = await seedProducts(clientId, [{ name: `Made ${rand()}` }]);
  const bomRows = (await sql`
    INSERT INTO public.boms (client_id, output_product_id, name)
    VALUES (${clientId}::uuid, ${outProd}::uuid, ${`BOM ${rand()}`})
    RETURNING id
  `) as Array<{ id: string }>;
  const bomId = bomRows[0]!.id;
  await sql`
    INSERT INTO public.production_orders (client_id, bom_id, qty, status)
    VALUES (${clientId}::uuid, ${bomId}::uuid, 30, 'in_progress'),
           (${clientId}::uuid, ${bomId}::uuid,  5, 'planned')
  `;
}

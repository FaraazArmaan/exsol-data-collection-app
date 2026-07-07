// Seed realistic inventory demo data for a workspace (default: papa-s-saloon).
//   npm run seed:inventory            # papa-s-saloon
//   npm run seed:inventory some-slug  # any client by slug
//
// Idempotent: safe to re-run. It (1) enables the inventory + products Products,
// (2) turns on the runtime decrement flag, (3) ensures a small physical retail
// catalog exists, (4) backfills a stock row per physical product with a varied
// starting quantity so some land below the reorder level (low-stock demo), and
// (5) records an opening-balance 'purchase' movement so the ledger isn't empty.
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set (run via `npm run seed:inventory`, which loads .env).');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

// A small saloon retail catalog so the demo has physical products to track even
// on a fresh workspace. SKUs (INV-*) make the upsert idempotent.
const DEMO_PRODUCTS = [
  { sku: 'INV-SHMP-500', name: 'Argan Repair Shampoo 500ml', price: 1800 },
  { sku: 'INV-COND-500', name: 'Argan Repair Conditioner 500ml', price: 1800 },
  { sku: 'INV-POMD-100', name: 'Matte Clay Pomade 100g', price: 1200 },
  { sku: 'INV-BEARD-50', name: 'Beard Oil 50ml', price: 950 },
  { sku: 'INV-WAX-75', name: 'Styling Wax 75g', price: 1100 },
  { sku: 'INV-TOWL-01', name: 'Microfiber Towel', price: 600 },
];

async function main(): Promise<void> {
  const clients = (await sql`
    SELECT id, name FROM public.clients WHERE slug = ${SLUG} LIMIT 1
  `) as Array<{ id: string; name: string }>;
  const client = clients[0];
  if (!client) {
    console.error(`No client found with slug "${SLUG}".`);
    process.exit(1);
  }
  const clientId = client.id;

  // 1. Enable the inventory Product (+ its 'products' dependency) AND pos.
  //    pos is needed for the golden flow (make a POS sale → watch qty drop), and
  //    the platform couples products⇒pos (migration 042 backfilled it for every
  //    product-enabled client), so enabling products without pos would break that
  //    invariant. Enabling all three keeps the demo whole and the invariant intact.
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${clientId}::uuid, 'products'), (${clientId}::uuid, 'pos'), (${clientId}::uuid, 'inventory')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;

  // 2. Turn on the per-client decrement flag so POS/storefront sales move stock.
  await sql`
    UPDATE public.clients SET inventory_tracking_enabled = true WHERE id = ${clientId}::uuid
  `;

  // 3. Ensure a physical retail catalog exists (idempotent on SKU).
  for (const dp of DEMO_PRODUCTS) {
    await sql`
      INSERT INTO public.products (client_id, type, name, price_cents, currency, sku, status)
      VALUES (${clientId}::uuid, 'physical', ${dp.name}, ${dp.price}, 'INR', ${dp.sku}, 'active')
      ON CONFLICT (client_id, sku) WHERE deleted_at IS NULL AND sku IS NOT NULL DO NOTHING
    `;
  }

  // 4. Backfill a stock row per physical, non-deleted product. Starting qty is
  //    varied (3..32) so a realistic fraction lands at/below reorder_level (10).
  const inserted = (await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
    SELECT p.client_id, p.id, 3 + (abs(hashtext(p.id::text)) % 30), 10
    FROM public.products p
    WHERE p.client_id = ${clientId}::uuid
      AND p.type = 'physical'
      AND p.deleted_at IS NULL
    ON CONFLICT (client_id, product_id) DO NOTHING
    RETURNING product_id
  `) as Array<{ product_id: string }>;

  // 5. Opening-balance 'purchase' movement for any product with an empty ledger.
  await sql`
    INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref)
    SELECT s.client_id, s.product_id, s.qty_on_hand, 'purchase', 'opening balance'
    FROM public.inventory_stock s
    WHERE s.client_id = ${clientId}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements m
        WHERE m.client_id = s.client_id AND m.product_id = s.product_id
      )
  `;

  // ── Depth demo data (idempotent) ────────────────────────────────────────
  // 6. Costed purchases: a received PO + line cost + matching 'purchase'
  //    movement (ref po:<id>) so the moving-average valuation has a cost basis.
  const hasPoCost = (await sql`
    SELECT 1 FROM public.stock_movements
    WHERE client_id = ${clientId}::uuid AND type = 'purchase' AND ref LIKE 'po:%' LIMIT 1
  `) as unknown[];
  if (hasPoCost.length === 0) {
    await sql`
      INSERT INTO public.suppliers (client_id, name)
      SELECT ${clientId}::uuid, 'Depot Supplies'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.suppliers WHERE client_id = ${clientId}::uuid AND name = 'Depot Supplies' AND deleted_at IS NULL
      )
    `;
    const supRows = (await sql`
      SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND name = 'Depot Supplies' AND deleted_at IS NULL LIMIT 1
    `) as Array<{ id: string }>;
    const supId = supRows[0]?.id;
    if (supId) {
      const po = (await sql`
        INSERT INTO public.purchase_orders (client_id, supplier_id, status, received_at)
        VALUES (${clientId}::uuid, ${supId}::uuid, 'received', now()) RETURNING id
      `) as Array<{ id: string }>;
      const poId = po[0]!.id;
      const prods = (await sql`
        SELECT p.id, p.price_cents,
               coalesce((SELECT qty_on_hand FROM public.inventory_stock s WHERE s.client_id = ${clientId}::uuid AND s.product_id = p.id), 10) AS qty
        FROM public.products p
        WHERE p.client_id = ${clientId}::uuid AND p.type = 'physical' AND p.deleted_at IS NULL
      `) as Array<{ id: string; price_cents: number; qty: number }>;
      for (const pr of prods) {
        const cost = Math.max(1, Math.round(pr.price_cents * 0.6));
        // qty_on_hand can legitimately be 0 (coalesce only guards NULL, not 0), but
        // purchase_order_items + purchase movements require qty > 0 — clamp to 1.
        const qty = Math.max(1, pr.qty);
        await sql`
          INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
          VALUES (${poId}::uuid, ${pr.id}::uuid, ${qty}, ${cost})
        `;
        await sql`
          INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref)
          VALUES (${clientId}::uuid, ${pr.id}::uuid, ${qty}, 'purchase', ${`po:${poId}`})
        `;
      }
    }
  }

  // 7. Lifecycle states — one seasonal, one discontinued (idempotent by SKU).
  await sql`
    UPDATE public.inventory_stock SET lifecycle_state = 'seasonal'
    WHERE client_id = ${clientId}::uuid
      AND product_id IN (SELECT id FROM public.products WHERE client_id = ${clientId}::uuid AND sku = 'INV-WAX-75')
  `;
  await sql`
    UPDATE public.inventory_stock SET lifecycle_state = 'discontinued'
    WHERE client_id = ${clientId}::uuid
      AND product_id IN (SELECT id FROM public.products WHERE client_id = ${clientId}::uuid AND sku = 'INV-TOWL-01')
  `;

  // 8. A warehouse location with ~half of each product's stock placed there.
  await sql`
    INSERT INTO public.warehouse_locations (client_id, name, kind)
    SELECT ${clientId}::uuid, 'Front Store', 'store'
    WHERE NOT EXISTS (SELECT 1 FROM public.warehouse_locations WHERE client_id = ${clientId}::uuid AND name = 'Front Store')
  `;
  const locRows = (await sql`
    SELECT id FROM public.warehouse_locations WHERE client_id = ${clientId}::uuid AND name = 'Front Store' LIMIT 1
  `) as Array<{ id: string }>;
  if (locRows[0]) {
    await sql`
      INSERT INTO public.stock_by_location (location_id, product_id, qty)
      SELECT ${locRows[0].id}::uuid, s.product_id, GREATEST(1, s.qty_on_hand / 2)
      FROM public.inventory_stock s WHERE s.client_id = ${clientId}::uuid
      ON CONFLICT (location_id, product_id) DO NOTHING
    `;
  }

  // 9. A restock + a writeoff return, only if none logged yet.
  const hasReturns = (await sql`SELECT 1 FROM public.inventory_returns WHERE client_id = ${clientId}::uuid LIMIT 1`) as unknown[];
  if (hasReturns.length === 0) {
    const someProd = (await sql`
      SELECT id FROM public.products WHERE client_id = ${clientId}::uuid AND type = 'physical' AND deleted_at IS NULL ORDER BY name LIMIT 1
    `) as Array<{ id: string }>;
    if (someProd[0]) {
      const pid = someProd[0].id;
      await sql`INSERT INTO public.inventory_returns (client_id, product_id, qty, disposition, reason) VALUES (${clientId}::uuid, ${pid}::uuid, 2, 'restock', 'Customer changed mind')`;
      await sql`INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref) VALUES (${clientId}::uuid, ${pid}::uuid, 2, 'return', 'Customer changed mind')`;
      await sql`UPDATE public.inventory_stock SET qty_on_hand = qty_on_hand + 2 WHERE client_id = ${clientId}::uuid AND product_id = ${pid}::uuid`;
      await sql`INSERT INTO public.inventory_returns (client_id, product_id, qty, disposition, reason) VALUES (${clientId}::uuid, ${pid}::uuid, 1, 'writeoff', 'Damaged in transit')`;
      await sql`INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref) VALUES (${clientId}::uuid, ${pid}::uuid, 0, 'writeoff', 'Damaged in transit')`;
    }
  }

  const counts = (await sql`
    SELECT
      (SELECT count(*) FROM public.inventory_stock  WHERE client_id = ${clientId}::uuid) AS stock_rows,
      (SELECT count(*) FROM public.inventory_stock  WHERE client_id = ${clientId}::uuid AND qty_on_hand <= reorder_level) AS low_rows,
      (SELECT count(*) FROM public.stock_movements  WHERE client_id = ${clientId}::uuid) AS movements
  `) as Array<{ stock_rows: number; low_rows: number; movements: number }>;
  const c = counts[0]!;

  console.log(`Seeded inventory for ${client.name} (${SLUG}):`);
  console.log(`  stock rows: ${c.stock_rows} (${inserted.length} new)`);
  console.log(`  low-stock:  ${c.low_rows}`);
  console.log(`  movements:  ${c.movements}`);
  console.log('  tracking flag: ON');
  console.log('  depth demo: costed purchases (valuation), lifecycle states, Front Store location, returns');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

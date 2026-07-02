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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

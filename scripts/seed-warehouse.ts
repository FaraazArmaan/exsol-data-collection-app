// Seed realistic warehouse demo data for a workspace (default: papa-s-saloon).
//   npm run seed:warehouse            # papa-s-saloon
//   npm run seed:warehouse some-slug  # any client by slug
//
// Idempotent: safe to re-run. It (1) enables the warehouse + inventory + products
// (+pos) Products, (2) creates three demo locations, and (3) allocates per-location
// stock from the existing inventory_stock rows so the stock-by-location view is
// populated and a transfer works immediately (golden flow). Assumes inventory has
// been seeded first (run `npm run seed:inventory` if the ledger looks empty) — it
// degrades gracefully to zero stock rows otherwise, never erroring.
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set (run via `npm run seed:warehouse`, which loads .env).');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

const DEMO_LOCATIONS = [
  { name: 'Main Warehouse', kind: 'warehouse' },
  { name: 'Front Store', kind: 'store' },
  { name: 'Back Storage', kind: 'storage' },
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

  // 1. Enable warehouse + its dependency chain (inventory → products → pos).
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${clientId}::uuid, 'products'), (${clientId}::uuid, 'pos'),
           (${clientId}::uuid, 'inventory'), (${clientId}::uuid, 'warehouse')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;

  // 2. Create the demo locations (idempotent on the (client_id, name) unique).
  for (const loc of DEMO_LOCATIONS) {
    await sql`
      INSERT INTO public.warehouse_locations (client_id, name, kind)
      VALUES (${clientId}::uuid, ${loc.name}, ${loc.kind})
      ON CONFLICT (client_id, name) DO NOTHING
    `;
  }

  const locRows = (await sql`
    SELECT id, name FROM public.warehouse_locations WHERE client_id = ${clientId}::uuid
  `) as Array<{ id: string; name: string }>;
  const byName = new Map(locRows.map((l) => [l.name, l.id]));
  const mainId = byName.get('Main Warehouse');
  const frontId = byName.get('Front Store');

  // 3a. Main Warehouse holds each product's full tracked on-hand.
  if (mainId) {
    await sql`
      INSERT INTO public.stock_by_location (location_id, product_id, qty)
      SELECT ${mainId}::uuid, s.product_id, s.qty_on_hand
      FROM public.inventory_stock s
      WHERE s.client_id = ${clientId}::uuid
      ON CONFLICT (location_id, product_id) DO NOTHING
    `;
  }

  // 3b. Front Store gets a small display slice (2 units) for stocked products, so
  //     the stock-by-location view shows more than one location out of the box.
  if (frontId) {
    await sql`
      INSERT INTO public.stock_by_location (location_id, product_id, qty)
      SELECT ${frontId}::uuid, s.product_id, LEAST(2, s.qty_on_hand)
      FROM public.inventory_stock s
      WHERE s.client_id = ${clientId}::uuid AND s.qty_on_hand > 0
      ON CONFLICT (location_id, product_id) DO NOTHING
    `;
  }

  const counts = (await sql`
    SELECT
      (SELECT count(*) FROM public.warehouse_locations WHERE client_id = ${clientId}::uuid) AS locations,
      (SELECT count(*) FROM public.stock_by_location sbl
         JOIN public.warehouse_locations l ON l.id = sbl.location_id
        WHERE l.client_id = ${clientId}::uuid) AS stock_rows
  `) as Array<{ locations: number; stock_rows: number }>;
  const c = counts[0]!;

  console.log(`Seeded warehouse for ${client.name} (${SLUG}):`);
  console.log(`  locations:  ${c.locations}`);
  console.log(`  stock rows: ${c.stock_rows}`);
  if (Number(c.stock_rows) === 0) {
    console.log('  (no inventory_stock found — run `npm run seed:inventory` first for stock to allocate.)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Seed realistic Manufacturing demo data for a workspace (default: papa-s-saloon).
//   npm run seed:manufacturing            # papa-s-saloon
//   npm run seed:manufacturing some-slug  # any client by slug
//
// Idempotent: (1) enables products+pos+inventory+manufacturing, (2) ensures
// component products + a "Signature Beard Kit" output product with stock,
// (3) defines one BOM, (4) creates a planned + an in_progress order so the
// UI lists aren't empty.
// Golden flow to demo live: open Manufacturing → Complete the in_progress
// order → component stock falls, kit stock rises.
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set (run via `npm run seed:manufacturing`, which loads .env).');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

// Component products (consumed when a production order is completed).
// SKUs (MFG-*) make the upsert idempotent — mirrors seed-inventory.ts pattern.
const COMPONENTS = [
  { sku: 'MFG-OIL-30',  name: 'Beard Oil 30ml (component)',  price: 700,  stock: 200 },
  { sku: 'MFG-BALM-30', name: 'Beard Balm 30g (component)',  price: 800,  stock: 150 },
  { sku: 'MFG-COMB-01', name: 'Wooden Comb (component)',      price: 300,  stock: 120 },
];
const OUTPUT = { sku: 'MFG-KIT-01', name: 'Signature Beard Kit', price: 2500 };

// Upsert a product by SKU (idempotent on the partial unique index
// (client_id, sku) WHERE deleted_at IS NULL AND sku IS NOT NULL).
// Returns the product id.
async function upsertProduct(
  clientId: string,
  p: { sku: string; name: string; price: number },
): Promise<string> {
  await sql`
    INSERT INTO public.products (client_id, type, name, price_cents, currency, sku, status)
    VALUES (${clientId}::uuid, 'physical', ${p.name}, ${p.price}, 'INR', ${p.sku}, 'active')
    ON CONFLICT (client_id, sku) WHERE deleted_at IS NULL AND sku IS NOT NULL DO NOTHING
  `;
  const found = (await sql`
    SELECT id FROM public.products
    WHERE client_id = ${clientId}::uuid AND sku = ${p.sku} AND deleted_at IS NULL
    LIMIT 1
  `) as Array<{ id: string }>;
  return found[0]!.id;
}

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

  // 1. Enable the full product chain including manufacturing (idempotent).
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${clientId}::uuid, 'products'), (${clientId}::uuid, 'pos'),
           (${clientId}::uuid, 'inventory'), (${clientId}::uuid, 'manufacturing')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
  await sql`
    UPDATE public.clients SET inventory_tracking_enabled = true WHERE id = ${clientId}::uuid
  `;

  // 2. Ensure component products + stock rows.
  const compIds: string[] = [];
  for (const c of COMPONENTS) {
    const id = await upsertProduct(clientId, c);
    compIds.push(id);
    // Set/reset to demo stock level on each run so the golden flow works repeatably.
    await sql`
      INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
      VALUES (${clientId}::uuid, ${id}::uuid, ${c.stock}, 20)
      ON CONFLICT (client_id, product_id) DO UPDATE SET qty_on_hand = ${c.stock}
    `;
  }

  // 3. Output product — stock starts at 0 (seed doesn't overwrite if already set).
  const outputId = await upsertProduct(clientId, OUTPUT);
  await sql`
    INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
    VALUES (${clientId}::uuid, ${outputId}::uuid, 0, 5)
    ON CONFLICT (client_id, product_id) DO NOTHING
  `;

  // 4. One BOM (idempotent by name — boms has no unique constraint on name,
  //    so we SELECT first then INSERT only if absent).
  let bomId: string;
  const existingBom = (await sql`
    SELECT id FROM public.boms
    WHERE client_id = ${clientId}::uuid AND name = 'Signature Beard Kit'
    LIMIT 1
  `) as Array<{ id: string }>;

  if (existingBom[0]) {
    bomId = existingBom[0].id;
  } else {
    const bomRows = (await sql`
      INSERT INTO public.boms (client_id, output_product_id, name)
      VALUES (${clientId}::uuid, ${outputId}::uuid, 'Signature Beard Kit')
      RETURNING id
    `) as Array<{ id: string }>;
    bomId = bomRows[0]!.id;
    // bom_components has UNIQUE (bom_id, component_product_id) — ON CONFLICT safe.
    await sql`
      INSERT INTO public.bom_components (bom_id, component_product_id, qty)
      VALUES
        (${bomId}::uuid, ${compIds[0]}::uuid, 1),
        (${bomId}::uuid, ${compIds[1]}::uuid, 1),
        (${bomId}::uuid, ${compIds[2]}::uuid, 1)
      ON CONFLICT (bom_id, component_product_id) DO NOTHING
    `;
  }

  // 5. Demo orders: one planned, one in_progress.
  //    Only insert if this BOM has no orders yet.
  const haveOrders = (await sql`
    SELECT 1 FROM public.production_orders WHERE bom_id = ${bomId}::uuid LIMIT 1
  `) as unknown[];

  if (haveOrders.length === 0) {
    await sql`
      INSERT INTO public.production_orders (client_id, bom_id, qty, status)
      VALUES
        (${clientId}::uuid, ${bomId}::uuid, 10, 'planned'),
        (${clientId}::uuid, ${bomId}::uuid, 25, 'in_progress')
    `;
  }

  const counts = (await sql`
    SELECT
      (SELECT count(*)::int FROM public.boms             WHERE client_id = ${clientId}::uuid)                  AS boms,
      (SELECT count(*)::int FROM public.bom_components   WHERE bom_id    = ${bomId}::uuid)                     AS bom_components,
      (SELECT count(*)::int FROM public.production_orders WHERE client_id = ${clientId}::uuid)                 AS orders,
      (SELECT count(*)::int FROM public.products          WHERE client_id = ${clientId}::uuid AND sku LIKE 'MFG-%' AND deleted_at IS NULL) AS mfg_products
  `) as Array<{ boms: number; bom_components: number; orders: number; mfg_products: number }>;
  const c = counts[0]!;

  console.log(`Seeded Manufacturing demo for ${client.name} (${SLUG}):`);
  console.log(`  MFG products:     ${c.mfg_products}`);
  console.log(`  BOMs:             ${c.boms}`);
  console.log(`  BOM components:   ${c.bom_components}`);
  console.log(`  production orders:${c.orders}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

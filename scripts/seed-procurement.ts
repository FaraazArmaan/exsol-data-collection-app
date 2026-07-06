// Seed realistic procurement demo data for a workspace (default: papa-s-saloon).
//   npm run seed:procurement            # papa-s-saloon
//   npm run seed:procurement some-slug  # any client by slug
//
// Idempotent: (1) enables the product chain (products + pos + inventory +
// procurement — pos keeps the products⇒pos invariant, inventory because
// receiving writes stock), (2) ensures demo suppliers (guarded by name), and
// (3) seeds two purchase orders (a draft + an ordered one) only if the client
// has none yet — both left un-received so the reviewer can drive the golden
// flow (Receive → inventory qty rises).
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set (run via `npm run seed:procurement`, which loads .env).');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

const DEMO_SUPPLIERS = [
  { name: 'Metro Beauty Supplies', phone: '+91 98200 11111', email: 'sales@metrobeauty.example', notes: 'Bulk salon consumables' },
  { name: 'Sharp Edge Distributors', phone: '+91 98200 22222', email: 'orders@sharpedge.example', notes: 'Tools, blades & clippers' },
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

  // 1. Enable the full product chain (idempotent).
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${clientId}::uuid, 'products'), (${clientId}::uuid, 'pos'),
           (${clientId}::uuid, 'inventory'), (${clientId}::uuid, 'procurement')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;

  // 2. Demo suppliers (idempotent by name).
  for (const s of DEMO_SUPPLIERS) {
    await sql`
      INSERT INTO public.suppliers (client_id, name, phone, email, notes)
      SELECT ${clientId}::uuid, ${s.name}, ${s.phone}, ${s.email}, ${s.notes}
      WHERE NOT EXISTS (
        SELECT 1 FROM public.suppliers
        WHERE client_id = ${clientId}::uuid AND name = ${s.name} AND deleted_at IS NULL
      )
    `;
  }

  // 3. Two demo purchase orders — only if the client has none yet.
  const existing = (await sql`
    SELECT count(*)::int AS n FROM public.purchase_orders WHERE client_id = ${clientId}::uuid
  `) as Array<{ n: number }>;
  let created = 0;

  if (existing[0]!.n === 0) {
    const suppliers = (await sql`
      SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL ORDER BY name LIMIT 2
    `) as Array<{ id: string }>;
    const products = (await sql`
      SELECT id FROM public.products
      WHERE client_id = ${clientId}::uuid AND type = 'physical' AND deleted_at IS NULL
      ORDER BY name LIMIT 3
    `) as Array<{ id: string }>;

    if (suppliers.length > 0 && products.length > 0) {
      const draft = (await sql`
        INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes)
        VALUES (${clientId}::uuid, ${suppliers[0]!.id}::uuid, 'draft', (now() + interval '7 days')::date, 'Weekly restock')
        RETURNING id
      `) as Array<{ id: string }>;
      for (const p of products) {
        await sql`
          INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
          VALUES (${draft[0]!.id}::uuid, ${p.id}::uuid, ${10}::int, ${5000}::bigint)
        `;
      }
      created++;

      const supplier2 = suppliers[1] ?? suppliers[0]!;
      const ordered = (await sql`
        INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes)
        VALUES (${clientId}::uuid, ${supplier2.id}::uuid, 'ordered', (now() + interval '3 days')::date, 'Awaiting delivery')
        RETURNING id
      `) as Array<{ id: string }>;
      await sql`
        INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
        VALUES (${ordered[0]!.id}::uuid, ${products[0]!.id}::uuid, ${25}::int, ${4200}::bigint)
      `;
      created++;
    }
  }

  const counts = (await sql`
    SELECT
      (SELECT count(*)::int FROM public.suppliers        WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL) AS suppliers,
      (SELECT count(*)::int FROM public.purchase_orders  WHERE client_id = ${clientId}::uuid) AS orders
  `) as Array<{ suppliers: number; orders: number }>;
  const c = counts[0]!;

  console.log(`Seeded procurement for ${client.name} (${SLUG}):`);
  console.log(`  suppliers:       ${c.suppliers}`);
  console.log(`  purchase orders: ${c.orders} (${created} new)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Seed supply-chain demo data for a workspace (default: papa-s-saloon).
//   npm run seed:supply-chain            # papa-s-saloon
//   npm run seed:supply-chain some-slug  # any client by slug
//
// Idempotent: enables all five backing products, ensures demo physical products,
// seeds 30 days of stock movements, an open supplier + two ordered POs, and
// a BOM + in-progress production order — all only if none exist yet.
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set (run via `npm run seed:supply-chain`, which loads .env).');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

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

  // 1. Enable the dashboard + its three backing products (idempotent).
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${clientId}::uuid, 'products'), (${clientId}::uuid, 'inventory'),
           (${clientId}::uuid, 'procurement'), (${clientId}::uuid, 'manufacturing'),
           (${clientId}::uuid, 'supply-chain')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
  await sql`
    UPDATE public.clients SET inventory_tracking_enabled = true WHERE id = ${clientId}::uuid
  `;

  // 2. Ensure a few demo physical products exist.
  const demoNames = ['SC Shampoo', 'SC Conditioner', 'SC Hair Oil', 'SC Wax'];
  for (const name of demoNames) {
    await sql`
      INSERT INTO public.products (client_id, type, name, price_cents, pos_visible, status)
      SELECT ${clientId}::uuid, 'physical', ${name}, 19900, true, 'active'::product_status
      WHERE NOT EXISTS (
        SELECT 1 FROM public.products
        WHERE client_id = ${clientId}::uuid AND name = ${name} AND deleted_at IS NULL
      )
    `;
  }
  const products = (await sql`
    SELECT id FROM public.products
    WHERE client_id = ${clientId}::uuid AND type = 'physical' AND deleted_at IS NULL
    ORDER BY name LIMIT 4
  `) as Array<{ id: string }>;

  // 3. Inventory stock — first product below reorder, rest healthy (idempotent).
  for (let i = 0; i < products.length; i++) {
    const onHand = i === 0 ? 2 : 40 + i * 5;
    await sql`
      INSERT INTO public.inventory_stock (client_id, product_id, qty_on_hand, reorder_level)
      VALUES (${clientId}::uuid, ${products[i]!.id}::uuid, ${onHand}::int, 10)
      ON CONFLICT (client_id, product_id) WHERE variant_id IS NULL DO NOTHING
    `;
  }

  // 4. 30 days of movements (only if none exist yet for this client).
  const mv = (await sql`
    SELECT count(*)::int AS n FROM public.stock_movements WHERE client_id = ${clientId}::uuid
  `) as Array<{ n: number }>;
  if (mv[0]!.n === 0 && products.length > 0) {
    for (let d = 0; d < 30; d++) {
      const p = products[d % products.length]!;
      const delta = d % 3 === 0 ? -(3 + (d % 5)) : (5 + (d % 7));
      const type = delta < 0 ? 'sale' : 'purchase';
      await sql`
        INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_at)
        VALUES (${clientId}::uuid, ${p.id}::uuid, ${delta}::int, ${type}, 'seed',
                now() - (${d}::text || ' days')::interval)
      `;
    }
  }

  // 5. A supplier + two 'ordered' POs with future expected dates (only if none open).
  await sql`
    INSERT INTO public.suppliers (client_id, name, phone, email, notes)
    SELECT ${clientId}::uuid, 'SC Metro Supplies', '+91 98200 33333', 'sc@metro.example', 'Demo supplier'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.suppliers WHERE client_id = ${clientId}::uuid AND name = 'SC Metro Supplies' AND deleted_at IS NULL
    )
  `;
  const openCount = (await sql`
    SELECT count(*)::int AS n FROM public.purchase_orders WHERE client_id = ${clientId}::uuid AND status = 'ordered'
  `) as Array<{ n: number }>;
  if (openCount[0]!.n === 0 && products.length > 0) {
    const supplier = (await sql`
      SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL ORDER BY name LIMIT 1
    `) as Array<{ id: string }>;
    for (const days of [3, 9]) {
      const po = (await sql`
        INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes)
        VALUES (${clientId}::uuid, ${supplier[0]!.id}::uuid, 'ordered', (now() + (${days}::text || ' days')::interval)::date, 'Awaiting delivery')
        RETURNING id
      `) as Array<{ id: string }>;
      await sql`
        INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
        VALUES (${po[0]!.id}::uuid, ${products[0]!.id}::uuid, 25, 4200)
      `;
    }
  }

  // 6. A BOM + an 'in_progress' production order (only if none in progress).
  const inProg = (await sql`
    SELECT count(*)::int AS n FROM public.production_orders WHERE client_id = ${clientId}::uuid AND status = 'in_progress'
  `) as Array<{ n: number }>;
  if (inProg[0]!.n === 0 && products.length > 0) {
    const bom = (await sql`
      INSERT INTO public.boms (client_id, output_product_id, name)
      VALUES (${clientId}::uuid, ${products[0]!.id}::uuid, 'SC Signature Blend')
      RETURNING id
    `) as Array<{ id: string }>;
    await sql`
      INSERT INTO public.production_orders (client_id, bom_id, qty, status)
      VALUES (${clientId}::uuid, ${bom[0]!.id}::uuid, 40, 'in_progress')
    `;
  }

  // 6b. BOM components — ensure the demo BOM has at least one component for the drill feature.
  const demoBomRows = (await sql`
    SELECT id FROM public.boms WHERE client_id = ${clientId}::uuid ORDER BY name LIMIT 1
  `) as Array<{ id: string }>;
  if (demoBomRows[0] && products.length >= 2) {
    const compCount = (await sql`
      SELECT count(*)::int AS n FROM public.bom_components WHERE bom_id = ${demoBomRows[0]!.id}::uuid
    `) as Array<{ n: number }>;
    if (compCount[0]!.n === 0) {
      await sql`
        INSERT INTO public.bom_components (bom_id, component_product_id, qty)
        VALUES (${demoBomRows[0]!.id}::uuid, ${products[1]!.id}::uuid, 3)
      `;
    }
  }

  // 7. Product suppliers — link SC demo products to demo suppliers (idempotent via ON CONFLICT).
  const allSuppliers = (await sql`
    SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL ORDER BY name LIMIT 3
  `) as Array<{ id: string }>;

  if (allSuppliers.length > 0 && products.length > 0) {
    // Ensure a second demo supplier exists.
    await sql`
      INSERT INTO public.suppliers (client_id, name, phone, email, notes)
      SELECT ${clientId}::uuid, 'SC Global Parts', '+91 98200 44444', 'sg@global.example', 'Demo supplier 2'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.suppliers WHERE client_id = ${clientId}::uuid AND name = 'SC Global Parts' AND deleted_at IS NULL
      )
    `;
    const suppliers = (await sql`
      SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL ORDER BY name LIMIT 2
    `) as Array<{ id: string }>;

    // Link product 0 to both suppliers (one primary, one alternate).
    if (suppliers[0] && products[0]) {
      await sql`
        INSERT INTO public.product_suppliers (client_id, product_id, supplier_id, lead_time_days, unit_cost_cents, is_primary)
        VALUES (${clientId}::uuid, ${products[0]!.id}::uuid, ${suppliers[0]!.id}::uuid, 5, 3500, true)
        ON CONFLICT (client_id, product_id, supplier_id) DO NOTHING
      `;
    }
    if (suppliers[1] && products[0]) {
      await sql`
        INSERT INTO public.product_suppliers (client_id, product_id, supplier_id, lead_time_days, unit_cost_cents, is_primary)
        VALUES (${clientId}::uuid, ${products[0]!.id}::uuid, ${suppliers[1]!.id}::uuid, 14, 3200, false)
        ON CONFLICT (client_id, product_id, supplier_id) DO NOTHING
      `;
    }
    // Link product 1 to one primary supplier.
    if (suppliers[0] && products[1]) {
      await sql`
        INSERT INTO public.product_suppliers (client_id, product_id, supplier_id, lead_time_days, unit_cost_cents, is_primary)
        VALUES (${clientId}::uuid, ${products[1]!.id}::uuid, ${suppliers[0]!.id}::uuid, 7, 4800, true)
        ON CONFLICT (client_id, product_id, supplier_id) DO NOTHING
      `;
    }
  }

  // 8. Risk demo data — ensures ≥1 of each risk kind for papa-s-saloon (idempotent).
  // 8a. single_supplier risk: products[2] (SC Hair Oil) gets exactly 1 primary link if it has 0.
  if (allSuppliers.length > 0 && products[2]) {
    const hairOilLinks = (await sql`
      SELECT count(*)::int AS n FROM public.product_suppliers
      WHERE client_id = ${clientId}::uuid AND product_id = ${products[2]!.id}::uuid
    `) as Array<{ n: number }>;
    if (hairOilLinks[0]!.n === 0) {
      const suppliers8 = (await sql`
        SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL ORDER BY name LIMIT 1
      `) as Array<{ id: string }>;
      if (suppliers8[0]) {
        await sql`
          INSERT INTO public.product_suppliers (client_id, product_id, supplier_id, lead_time_days, unit_cost_cents, is_primary)
          VALUES (${clientId}::uuid, ${products[2]!.id}::uuid, ${suppliers8[0]!.id}::uuid, 7, 2800, true)
          ON CONFLICT (client_id, product_id, supplier_id) DO NOTHING
        `;
      }
    }
  }

  // 8b. lead_time_collision risk: products[0] (SC Shampoo) primary supplier lead_time bumped to 21
  //     if it's currently < 14 (SC Shampoo already has qty_on_hand=2 <= reorder_level=10).
  if (products[0]) {
    await sql`
      UPDATE public.product_suppliers
      SET lead_time_days = 21
      WHERE client_id = ${clientId}::uuid
        AND product_id = ${products[0]!.id}::uuid
        AND is_primary = true
        AND lead_time_days < 14
    `;
  }

  // 8c. overdue_po risk: add a PO with expected_on 5 days ago if none exists.
  const overduePOs = (await sql`
    SELECT count(*)::int AS n FROM public.purchase_orders
    WHERE client_id = ${clientId}::uuid AND status = 'ordered' AND expected_on < CURRENT_DATE
  `) as Array<{ n: number }>;
  if (overduePOs[0]!.n === 0 && products[0]) {
    const supplier8c = (await sql`
      SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL ORDER BY name LIMIT 1
    `) as Array<{ id: string }>;
    if (supplier8c[0]) {
      const overduePo = (await sql`
        INSERT INTO public.purchase_orders (client_id, supplier_id, status, expected_on, notes)
        VALUES (${clientId}::uuid, ${supplier8c[0]!.id}::uuid, 'ordered', (now() - interval '5 days')::date, 'Demo overdue PO')
        RETURNING id
      `) as Array<{ id: string }>;
      await sql`
        INSERT INTO public.purchase_order_items (purchase_order_id, product_id, qty, unit_cost_cents)
        VALUES (${overduePo[0]!.id}::uuid, ${products[0]!.id}::uuid, 10, 4200)
      `;
    }
  }

  // 9. CO2 emission factors — per SC demo categories + client default (idempotent).
  // Insert client default first (category_id IS NULL).
  await sql`
    INSERT INTO public.co2_emission_factors (client_id, category_id, kg_co2_per_unit)
    VALUES (${clientId}::uuid, NULL, 0.5)
    ON CONFLICT (client_id) WHERE category_id IS NULL DO NOTHING
  `;
  // Insert per-category factors for any product_categories on this client.
  const cats = (await sql`
    SELECT id FROM public.product_categories
    WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
    ORDER BY name LIMIT 5
  `) as Array<{ id: string }>;
  const co2Values = [1.2, 0.8, 2.1, 0.4, 1.5];
  for (let i = 0; i < cats.length; i++) {
    await sql`
      INSERT INTO public.co2_emission_factors (client_id, category_id, kg_co2_per_unit)
      VALUES (${clientId}::uuid, ${cats[i]!.id}::uuid, ${co2Values[i % co2Values.length]!}::numeric)
      ON CONFLICT (client_id, category_id) WHERE category_id IS NOT NULL DO NOTHING
    `;
  }

  const counts = (await sql`
    SELECT
      (SELECT count(*)::int FROM public.inventory_stock  WHERE client_id = ${clientId}::uuid AND qty_on_hand <= reorder_level) AS low_stock,
      (SELECT count(*)::int FROM public.stock_movements  WHERE client_id = ${clientId}::uuid) AS movements,
      (SELECT count(*)::int FROM public.purchase_orders  WHERE client_id = ${clientId}::uuid AND status = 'ordered') AS open_pos,
      (SELECT count(*)::int FROM public.production_orders WHERE client_id = ${clientId}::uuid AND status = 'in_progress') AS in_progress,
      (SELECT count(*)::int FROM public.product_suppliers WHERE client_id = ${clientId}::uuid) AS supplier_links,
      (SELECT count(*)::int FROM public.co2_emission_factors WHERE client_id = ${clientId}::uuid) AS co2_factors
  `) as Array<{ low_stock: number; movements: number; open_pos: number; in_progress: number; supplier_links: number; co2_factors: number }>;
  const c = counts[0]!;
  console.log(`Seeded supply-chain for ${client.name} (${SLUG}):`);
  console.log(`  low-stock items:   ${c.low_stock}`);
  console.log(`  stock movements:   ${c.movements}`);
  console.log(`  open POs:          ${c.open_pos}`);
  console.log(`  in-progress prod:  ${c.in_progress}`);
  console.log(`  supplier links:    ${c.supplier_links}`);
  console.log(`  co2 factors:       ${c.co2_factors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

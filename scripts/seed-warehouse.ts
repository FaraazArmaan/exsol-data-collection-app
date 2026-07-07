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

  // 4. Putaway queue demo. First pull any real received-PO lines (from the
  //    procurement seed) that lack a task; then, if the queue is still empty,
  //    enqueue a couple of manual pending tasks so the tab always demos.
  await sql`
    INSERT INTO public.warehouse_putaway_tasks
      (client_id, purchase_order_id, purchase_order_item_id, product_id, qty)
    SELECT po.client_id, po.id, poi.id, poi.product_id, poi.qty
    FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.client_id = ${clientId}::uuid AND po.status = 'received'
    ON CONFLICT (purchase_order_item_id) WHERE purchase_order_item_id IS NOT NULL DO NOTHING
  `;
  await sql`
    INSERT INTO public.warehouse_putaway_tasks (client_id, product_id, qty)
    SELECT p.client_id, p.id, 4
    FROM public.products p
    WHERE p.client_id = ${clientId}::uuid AND p.type = 'physical' AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.warehouse_putaway_tasks t WHERE t.client_id = ${clientId}::uuid
      )
    LIMIT 3
  `;

  // 5. One demo inbound ASN (idempotent: only when the client has none). Lines
  //    are a couple of physical products with expected quantities, so the Inbound
  //    tab and its expected-vs-received flow demo out of the box.
  const asnExists = (await sql`
    SELECT 1 FROM public.inbound_asns WHERE client_id = ${clientId}::uuid LIMIT 1
  `) as unknown[];
  if (asnExists.length === 0) {
    const asnRows = (await sql`
      INSERT INTO public.inbound_asns (client_id, reference, carrier, eta, status)
      VALUES (${clientId}::uuid, 'SHIP-DEMO-001', 'BlueDart', current_date + 3, 'pending')
      RETURNING id
    `) as Array<{ id: string }>;
    await sql`
      INSERT INTO public.asn_lines (asn_id, product_id, expected_qty)
      SELECT ${asnRows[0]!.id}::uuid, p.id, 12
      FROM public.products p
      WHERE p.client_id = ${clientId}::uuid AND p.type = 'physical' AND p.deleted_at IS NULL
      ORDER BY p.name ASC
      LIMIT 3
      ON CONFLICT (asn_id, product_id) DO NOTHING
    `;
  }

  // 6. Safety demo (idempotent per client): one open incident + two recurring
  //    checklists, one signed (up to date) and one never-signed (due).
  const incidentExists = (await sql`
    SELECT 1 FROM public.safety_incidents WHERE client_id = ${clientId}::uuid LIMIT 1
  `) as unknown[];
  if (incidentExists.length === 0) {
    await sql`
      INSERT INTO public.safety_incidents (client_id, severity, title, description, status)
      VALUES (${clientId}::uuid, 'medium', 'Wet floor near receiving', 'Condensation from the chiller; mopped and signed.', 'open')
    `;
  }
  const checklistExists = (await sql`
    SELECT 1 FROM public.safety_checklists WHERE client_id = ${clientId}::uuid LIMIT 1
  `) as unknown[];
  if (checklistExists.length === 0) {
    const chk = (await sql`
      INSERT INTO public.safety_checklists (client_id, title, cadence)
      VALUES (${clientId}::uuid, 'Fire-exit inspection', 'weekly'),
             (${clientId}::uuid, 'Forklift pre-use check', 'daily')
      RETURNING id, title
    `) as Array<{ id: string; title: string }>;
    const weekly = chk.find((c) => c.title === 'Fire-exit inspection');
    if (weekly) {
      await sql`
        INSERT INTO public.safety_checklist_signoffs (checklist_id, notes)
        VALUES (${weekly.id}::uuid, 'All exits clear')
      `;
    }
  }

  // 7. One pending AI slotting suggestion (idempotent) — move a pick-face buffer
  //    from Main Warehouse to Front Store. The live "Generate" button re-derives
  //    these from movement velocity; this just guarantees the tab demos.
  if (mainId && frontId) {
    await sql`
      INSERT INTO public.warehouse_slotting_suggestions
        (client_id, product_id, from_location_id, to_location_id, suggested_qty, velocity, rationale, ai_fallback, status)
      SELECT ${clientId}::uuid, sbl.product_id, ${mainId}::uuid, ${frontId}::uuid,
             GREATEST(1, sbl.qty / 2), 0,
             'High-turnover item — a pick-face buffer in the store cuts walk time during service.',
             true, 'pending'
      FROM public.stock_by_location sbl
      WHERE sbl.location_id = ${mainId}::uuid AND sbl.qty >= 4
        AND NOT EXISTS (
          SELECT 1 FROM public.warehouse_slotting_suggestions s
          WHERE s.client_id = ${clientId}::uuid AND s.status = 'pending'
        )
      ORDER BY sbl.qty DESC
      LIMIT 2
    `;
  }

  const counts = (await sql`
    SELECT
      (SELECT count(*) FROM public.warehouse_locations WHERE client_id = ${clientId}::uuid) AS locations,
      (SELECT count(*) FROM public.stock_by_location sbl
         JOIN public.warehouse_locations l ON l.id = sbl.location_id
        WHERE l.client_id = ${clientId}::uuid) AS stock_rows,
      (SELECT count(*) FROM public.warehouse_putaway_tasks
        WHERE client_id = ${clientId}::uuid AND status = 'pending') AS pending_putaway,
      (SELECT count(*) FROM public.inbound_asns WHERE client_id = ${clientId}::uuid) AS asns,
      (SELECT count(*) FROM public.safety_incidents WHERE client_id = ${clientId}::uuid) AS incidents,
      (SELECT count(*) FROM public.safety_checklists WHERE client_id = ${clientId}::uuid) AS checklists,
      (SELECT count(*) FROM public.warehouse_slotting_suggestions
        WHERE client_id = ${clientId}::uuid AND status = 'pending') AS suggestions
  `) as Array<{ locations: number; stock_rows: number; pending_putaway: number; asns: number; incidents: number; checklists: number; suggestions: number }>;
  const c = counts[0]!;

  console.log(`Seeded warehouse for ${client.name} (${SLUG}):`);
  console.log(`  locations:       ${c.locations}`);
  console.log(`  stock rows:      ${c.stock_rows}`);
  console.log(`  pending putaway: ${c.pending_putaway}`);
  console.log(`  inbound ASNs:    ${c.asns}`);
  console.log(`  safety:          ${c.incidents} incident(s), ${c.checklists} checklist(s)`);
  console.log(`  AI suggestions:  ${c.suggestions} pending`);
  if (Number(c.stock_rows) === 0) {
    console.log('  (no inventory_stock found — run `npm run seed:inventory` first for stock to allocate.)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

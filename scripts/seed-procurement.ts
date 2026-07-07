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

  // ── Depth demo data (idempotent) ─────────────────────────────────────────
  // 4. Supplier deepen: payment terms + rating + one contact.
  await sql`UPDATE public.suppliers SET payment_terms = 'Net 30', rating = 4 WHERE client_id = ${clientId}::uuid AND name = 'Metro Beauty Supplies'`;
  await sql`UPDATE public.suppliers SET payment_terms = 'Net 15', rating = 5 WHERE client_id = ${clientId}::uuid AND name = 'Sharp Edge Distributors'`;
  const metro = (await sql`
    SELECT id FROM public.suppliers WHERE client_id = ${clientId}::uuid AND name = 'Metro Beauty Supplies' AND deleted_at IS NULL LIMIT 1
  `) as Array<{ id: string }>;
  if (metro[0]) {
    const hasContact = (await sql`SELECT 1 FROM public.supplier_contacts WHERE supplier_id = ${metro[0].id}::uuid LIMIT 1`) as unknown[];
    if (hasContact.length === 0) {
      await sql`
        INSERT INTO public.supplier_contacts (client_id, supplier_id, name, role, phone, email)
        VALUES (${clientId}::uuid, ${metro[0].id}::uuid, 'Priya Rao', 'Account manager', '+91 98200 33333', 'priya@metrobeauty.example')
      `;
    }
    // 5. Supplier prices (a prior + a current price per product) — guard: none yet.
    const hasPrices = (await sql`SELECT 1 FROM public.supplier_prices WHERE supplier_id = ${metro[0].id}::uuid LIMIT 1`) as unknown[];
    if (hasPrices.length === 0) {
      const prods = (await sql`
        SELECT id FROM public.products WHERE client_id = ${clientId}::uuid AND type = 'physical' AND deleted_at IS NULL ORDER BY name LIMIT 3
      `) as Array<{ id: string }>;
      for (const p of prods) {
        await sql`INSERT INTO public.supplier_prices (client_id, supplier_id, product_id, unit_cost_cents, effective_from) VALUES (${clientId}::uuid, ${metro[0].id}::uuid, ${p.id}::uuid, ${4800}::bigint, (current_date - interval '30 days')::date)`;
        await sql`INSERT INTO public.supplier_prices (client_id, supplier_id, product_id, unit_cost_cents) VALUES (${clientId}::uuid, ${metro[0].id}::uuid, ${p.id}::uuid, ${5000}::bigint)`;
      }
    }
  }

  // 6. Approval threshold — POs over ₹2,000 require approval.
  await sql`UPDATE public.clients SET po_approval_threshold_cents = 200000 WHERE id = ${clientId}::uuid`;

  // 7. A matching GRN + invoice for the ordered PO, so the 3-way match screen has
  //    a clean match ready to confirm.
  const orderedPo = (await sql`
    SELECT id FROM public.purchase_orders WHERE client_id = ${clientId}::uuid AND status = 'ordered' ORDER BY created_at LIMIT 1
  `) as Array<{ id: string }>;
  if (orderedPo[0]) {
    const hasGrn = (await sql`SELECT 1 FROM public.goods_receipts WHERE purchase_order_id = ${orderedPo[0].id}::uuid LIMIT 1`) as unknown[];
    if (hasGrn.length === 0) {
      const items = (await sql`
        SELECT product_id, qty, unit_cost_cents FROM public.purchase_order_items WHERE purchase_order_id = ${orderedPo[0].id}::uuid
      `) as Array<{ product_id: string; qty: number; unit_cost_cents: string }>;
      const grn = (await sql`
        INSERT INTO public.goods_receipts (client_id, purchase_order_id, note) VALUES (${clientId}::uuid, ${orderedPo[0].id}::uuid, 'Full delivery') RETURNING id
      `) as Array<{ id: string }>;
      let total = 0;
      for (const it of items) {
        await sql`INSERT INTO public.goods_receipt_items (goods_receipt_id, product_id, qty_received) VALUES (${grn[0]!.id}::uuid, ${it.product_id}::uuid, ${it.qty}::int)`;
        total += it.qty * Number(it.unit_cost_cents);
      }
      await sql`INSERT INTO public.supplier_invoices (client_id, purchase_order_id, invoice_number, amount_cents) VALUES (${clientId}::uuid, ${orderedPo[0].id}::uuid, 'INV-DEMO-001', ${total}::bigint)`;
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
  console.log('  depth demo: terms/ratings + contact, supplier prices, approval threshold ₹2,000, GRN+invoice for match');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

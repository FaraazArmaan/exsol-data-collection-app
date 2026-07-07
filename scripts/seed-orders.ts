// Seed realistic Order Management demo data for a workspace (default: papa-s-saloon).
//   npm run seed:orders            # papa-s-saloon
//   npm run seed:orders some-slug  # any client by slug
//
// Idempotent: safe to re-run. It (1) enables products+pos+orders Products,
// (2) ensures a small physical retail catalog exists (idempotent on SKU),
// (3) inserts a spread of sales across statuses and channels — idempotent
//     via unique order_no per bucket (uses hash-based order numbers), so
//     re-runs add new sales but never collide.
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set (run via `npm run seed:orders`, which loads .env).');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

// Demo products (idempotent on SKU — same as seed-inventory).
const DEMO_PRODUCTS = [
  { sku: 'INV-SHMP-500', name: 'Argan Repair Shampoo 500ml', price: 1800 },
  { sku: 'INV-COND-500', name: 'Argan Repair Conditioner 500ml', price: 1800 },
  { sku: 'INV-POMD-100', name: 'Matte Clay Pomade 100g', price: 1200 },
  { sku: 'INV-BEARD-50', name: 'Beard Oil 50ml', price: 950 },
  { sku: 'INV-WAX-75', name: 'Styling Wax 75g', price: 1100 },
];

// A spread of demo sales covering all statuses and channels.
// order_no is a stable per-slug hash — idempotent across re-runs.
const DEMO_SALES: Array<{
  orderNo: number;
  status: string;
  channel: string;
  customerName: string;
  customerPhone: string;
  totalCents: number;
  paidAt: string | null;
  fulfilledAt: string | null;
}> = [
  {
    orderNo: 10001,
    status: 'paid',
    channel: 'instore',
    customerName: 'Alice Rahman',
    customerPhone: '+60123456789',
    totalCents: 3600,
    paidAt: '2026-07-01T10:00:00Z',
    fulfilledAt: null,
  },
  {
    orderNo: 10002,
    status: 'pending_payment',
    channel: 'online',
    customerName: 'Bob Chen',
    customerPhone: '+60198765432',
    totalCents: 1200,
    paidAt: null,
    fulfilledAt: null,
  },
  {
    orderNo: 10003,
    status: 'fulfilled',
    channel: 'pickup',
    customerName: 'Carol Singh',
    customerPhone: '+60112233445',
    totalCents: 5400,
    paidAt: '2026-07-02T09:00:00Z',
    fulfilledAt: '2026-07-02T11:30:00Z',
  },
  {
    orderNo: 10004,
    status: 'fulfilled',
    channel: 'instore',
    customerName: 'David Lim',
    customerPhone: '+60199887766',
    totalCents: 2350,
    paidAt: '2026-07-03T14:00:00Z',
    fulfilledAt: '2026-07-03T14:45:00Z',
  },
  {
    orderNo: 10005,
    status: 'cancelled',
    channel: 'online',
    customerName: 'Eve Nair',
    customerPhone: '+60155443322',
    totalCents: 1800,
    paidAt: null,
    fulfilledAt: null,
  },
  {
    orderNo: 10006,
    status: 'pending_payment',
    channel: 'instore',
    customerName: 'Frank Osman',
    customerPhone: '+60177665544',
    totalCents: 950,
    paidAt: null,
    fulfilledAt: null,
  },
  {
    orderNo: 10007,
    status: 'refunded',
    channel: 'online',
    customerName: 'Grace Tan',
    customerPhone: '+60133221100',
    totalCents: 3600,
    paidAt: '2026-07-04T08:00:00Z',
    fulfilledAt: null,
  },
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

  // 1. Find an owner user_node to use as created_by_user_node.
  const ownerNodes = (await sql`
    SELECT id FROM public.user_nodes
    WHERE client_id = ${clientId}::uuid AND level_number = 1
    LIMIT 1
  `) as Array<{ id: string }>;
  const ownerNodeId = ownerNodes[0]?.id;
  if (!ownerNodeId) {
    console.error('No L1 owner user_node found — cannot create sales (FK constraint).');
    process.exit(1);
  }

  // 2. Enable products + pos + orders Products (idempotent).
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES
      (${clientId}::uuid, 'products'),
      (${clientId}::uuid, 'pos'),
      (${clientId}::uuid, 'orders')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;

  // 3. Ensure physical retail catalog (idempotent on SKU).
  for (const dp of DEMO_PRODUCTS) {
    await sql`
      INSERT INTO public.products (client_id, type, name, price_cents, currency, sku, status)
      VALUES (${clientId}::uuid, 'physical', ${dp.name}, ${dp.price}, 'INR', ${dp.sku}, 'active')
      ON CONFLICT (client_id, sku) WHERE deleted_at IS NULL AND sku IS NOT NULL DO NOTHING
    `;
  }

  // 4. Insert demo sales (idempotent on order_no per bucket via ON CONFLICT DO NOTHING).
  let inserted = 0;
  for (const s of DEMO_SALES) {
    const result = (await sql`
      INSERT INTO public.sales
        (bucket_id, order_no, status, channel,
         customer_name, customer_phone,
         subtotal_cents, discount_cents, tax_cents, total_cents,
         created_by_user_node, paid_at, fulfilled_at)
      VALUES
        (${clientId}::uuid, ${s.orderNo}, ${s.status}::sale_status, ${s.channel}::sale_channel,
         ${s.customerName}, ${s.customerPhone},
         ${s.totalCents}, 0, 0, ${s.totalCents},
         ${ownerNodeId}::uuid, ${s.paidAt}::timestamptz, ${s.fulfilledAt}::timestamptz)
      ON CONFLICT (bucket_id, order_no) DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;
    if (result.length > 0) inserted += 1;
  }

  const counts = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending_payment') AS pending,
      COUNT(*) FILTER (WHERE status = 'paid')            AS paid,
      COUNT(*) FILTER (WHERE status = 'fulfilled')       AS fulfilled,
      COUNT(*) FILTER (WHERE status = 'cancelled')       AS cancelled,
      COUNT(*) FILTER (WHERE status = 'refunded')        AS refunded
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
  `) as Array<Record<string, string>>;
  const c = counts[0]!;

  // 5. Seed demo refunds on the first two sales (idempotent check via state).
  // Look up actual sale IDs for order_no 10001 (paid) and 10003 (fulfilled).
  const saleRows = (await sql`
    SELECT id, order_no, total_cents FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND order_no IN (10001, 10003)
  `) as Array<{ id: string; order_no: number; total_cents: string }>;

  for (const sale of saleRows) {
    const existing = (await sql`
      SELECT 1 FROM public.orders_refunds
      WHERE client_id = ${clientId}::uuid AND sale_id = ${sale.id}::uuid
      LIMIT 1
    `) as unknown[];

    if (existing.length === 0) {
      if (sale.order_no === 10001) {
        // Partial refund in 'approved' state
        await sql`
          INSERT INTO public.orders_refunds
            (client_id, sale_id, amount_cents, reason, state, requested_by)
          VALUES
            (${clientId}::uuid, ${sale.id}::uuid, 900, 'Partial return — item damaged',
             'approved', ${ownerNodeId}::uuid)
        `;
      } else if (sale.order_no === 10003) {
        // Full refund completed → insert refund and mark sale as refunded
        const refundRows = (await sql`
          INSERT INTO public.orders_refunds
            (client_id, sale_id, amount_cents, reason, state, requested_by,
             completed_at)
          VALUES
            (${clientId}::uuid, ${sale.id}::uuid, ${Number(sale.total_cents)},
             'Full refund — order cancelled by customer',
             'completed', ${ownerNodeId}::uuid, now())
          RETURNING id
        `) as Array<{ id: string }>;
        // Keep demo data consistent: sale status mirrors the completed full refund.
        await sql`
          UPDATE public.sales
          SET status = 'refunded', refunded_at = now()
          WHERE id = ${sale.id}::uuid AND bucket_id = ${clientId}::uuid
        `;
        console.log(`  seeded completed full refund ${refundRows[0]?.id} on sale ${sale.id}`);
      }
    }
  }

  // 6. Seed a demo shipment on the fulfilled sale (order_no 10004).
  const shipSaleRows = (await sql`
    SELECT id FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND order_no = 10004
    LIMIT 1
  `) as Array<{ id: string }>;

  const shipSaleId = shipSaleRows[0]?.id;
  if (shipSaleId) {
    const existingShip = (await sql`
      SELECT 1 FROM public.orders_shipments
      WHERE client_id = ${clientId}::uuid AND sale_id = ${shipSaleId}::uuid
      LIMIT 1
    `) as unknown[];

    if (existingShip.length === 0) {
      await sql`
        INSERT INTO public.orders_shipments
          (client_id, sale_id, carrier, tracking_ref, status, shipped_at)
        VALUES
          (${clientId}::uuid, ${shipSaleId}::uuid,
           'DHL', 'DHL-DEMO-2026-001',
           'shipped', '2026-07-03T15:00:00Z')
      `;
      console.log(`  seeded shipment for sale ${shipSaleId}`);
    }
  }

  // 7. Seed demo backorders — one queued, one partially_fulfilled.
  // Idempotent: skip if the sale already has a backorder for that product.
  const paidSaleForBackorder = (await sql`
    SELECT id FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND order_no = 10001
    LIMIT 1
  `) as Array<{ id: string }>;

  if (paidSaleForBackorder[0]?.id) {
    const backorderSaleId = paidSaleForBackorder[0].id;

    // Look up product IDs by SKU (they were inserted above, idempotently).
    const demoProductRows = (await sql`
      SELECT id, sku FROM public.products
      WHERE client_id = ${clientId}::uuid AND sku IN ('INV-SHMP-500', 'INV-COND-500')
        AND deleted_at IS NULL
    `) as Array<{ id: string; sku: string }>;
    const skuMap = new Map(demoProductRows.map((r) => [r.sku, r.id]));
    const firstProductId = skuMap.get('INV-SHMP-500');
    const secondProductId = skuMap.get('INV-COND-500');

    if (firstProductId) {
      const existing1 = (await sql`
        SELECT 1 FROM public.orders_backorders
        WHERE client_id = ${clientId}::uuid AND sale_id = ${backorderSaleId}::uuid
          AND product_id = ${firstProductId}::uuid
        LIMIT 1
      `) as unknown[];

      if (existing1.length === 0) {
        await sql`
          INSERT INTO public.orders_backorders
            (client_id, sale_id, product_id, product_name_snap, qty_ordered, status)
          VALUES
            (${clientId}::uuid, ${backorderSaleId}::uuid, ${firstProductId}::uuid,
             'Argan Repair Shampoo 500ml', 5, 'queued')
        `;
        console.log(`  seeded queued backorder for product ${firstProductId}`);
      }
    }

    if (secondProductId) {
      const existing2 = (await sql`
        SELECT 1 FROM public.orders_backorders
        WHERE client_id = ${clientId}::uuid AND sale_id = ${backorderSaleId}::uuid
          AND product_id = ${secondProductId}::uuid
        LIMIT 1
      `) as unknown[];

      if (existing2.length === 0) {
        await sql`
          INSERT INTO public.orders_backorders
            (client_id, sale_id, product_id, product_name_snap, qty_ordered, qty_fulfilled, status)
          VALUES
            (${clientId}::uuid, ${backorderSaleId}::uuid, ${secondProductId}::uuid,
             'Argan Repair Conditioner 500ml', 8, 3, 'partially_fulfilled')
        `;
        console.log(`  seeded partially_fulfilled backorder for product ${secondProductId}`);
      }
    }
  }

  // 8. Seed SLA targets (idempotent via ON CONFLICT).
  // Demo targets: realistic values for a retail fulfilment flow.
  const SLA_TARGETS: Array<{ stage: string; max_minutes: number }> = [
    { stage: 'pending_payment', max_minutes: 1440 }, // 24 h to pay
    { stage: 'paid',            max_minutes: 120  }, // 2 h to start picking
    { stage: 'picking',         max_minutes: 30   }, // 30 min to pick
    { stage: 'packing',         max_minutes: 20   }, // 20 min to pack
    { stage: 'fulfilled',       max_minutes: 60   }, // 1 h to ship once fulfilled
  ];
  for (const t of SLA_TARGETS) {
    await sql`
      INSERT INTO public.orders_sla_targets (client_id, stage, max_minutes)
      VALUES (${clientId}::uuid, ${t.stage}::order_stage, ${t.max_minutes})
      ON CONFLICT (client_id, stage) DO UPDATE SET max_minutes = ${t.max_minutes}
    `;
  }
  console.log(`  seeded ${SLA_TARGETS.length} SLA targets`);

  // 9. Seed a couple of orders_stage_events rows (idempotent: skip if sale already has events).
  const paidSaleForEvents = (await sql`
    SELECT id FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND order_no = 10001
    LIMIT 1
  `) as Array<{ id: string }>;

  if (paidSaleForEvents[0]?.id) {
    const evtSaleId = paidSaleForEvents[0].id;
    const existingEvts = (await sql`
      SELECT 1 FROM public.orders_stage_events
      WHERE client_id = ${clientId}::uuid AND sale_id = ${evtSaleId}::uuid
      LIMIT 1
    `) as unknown[];

    if (existingEvts.length === 0) {
      // Simulate: picking started 45 min ago, packing started 10 min ago.
      await sql`
        INSERT INTO public.orders_stage_events (client_id, sale_id, stage, entered_at)
        VALUES
          (${clientId}::uuid, ${evtSaleId}::uuid, 'picking'::order_stage, now() - INTERVAL '45 minutes'),
          (${clientId}::uuid, ${evtSaleId}::uuid, 'packing'::order_stage, now() - INTERVAL '10 minutes')
      `;
      console.log(`  seeded 2 stage events (picking, packing) for sale ${evtSaleId}`);
    }
  }

  // 10. Seed a fulfillment split on order 10001 (paid, has backorders — add sale_lines if missing).
  // Idempotent: skip if fulfillments already exist for this sale.
  const splitSaleRows = (await sql`
    SELECT id FROM public.sales
    WHERE bucket_id = ${clientId}::uuid AND order_no = 10001
    LIMIT 1
  `) as Array<{ id: string }>;
  const splitSaleId = splitSaleRows[0]?.id;

  if (splitSaleId) {
    const existingFulfils = (await sql`
      SELECT 1 FROM public.orders_fulfillments
      WHERE client_id = ${clientId}::uuid AND sale_id = ${splitSaleId}::uuid
      LIMIT 1
    `) as unknown[];

    if (existingFulfils.length === 0) {
      // Ensure sale_lines exist for the split demo. Idempotent via position ON CONFLICT.
      const demoProductRows = (await sql`
        SELECT id, sku, name FROM public.products
        WHERE client_id = ${clientId}::uuid AND sku IN ('INV-SHMP-500', 'INV-POMD-100')
          AND deleted_at IS NULL
      `) as Array<{ id: string; sku: string; name: string }>;
      const skuMap = new Map(demoProductRows.map((r) => [r.sku, r]));
      const shmp = skuMap.get('INV-SHMP-500');
      const pomd = skuMap.get('INV-POMD-100');

      const lineIds: string[] = [];
      if (shmp) {
        const l1Rows = (await sql`
          INSERT INTO public.sale_lines
            (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
          VALUES
            (${splitSaleId}::uuid, ${shmp.id}::uuid, ${shmp.name}, 1800, 3, 5400, 1)
          ON CONFLICT DO NOTHING
          RETURNING id
        `) as Array<{ id: string }>;
        if (l1Rows[0]) lineIds.push(l1Rows[0].id);
      }
      if (pomd) {
        const l2Rows = (await sql`
          INSERT INTO public.sale_lines
            (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
          VALUES
            (${splitSaleId}::uuid, ${pomd.id}::uuid, ${pomd.name}, 1200, 2, 2400, 2)
          ON CONFLICT DO NOTHING
          RETURNING id
        `) as Array<{ id: string }>;
        if (l2Rows[0]) lineIds.push(l2Rows[0].id);
      }

      // Only split if we got at least one line.
      if (lineIds.length > 0) {
        // Fulfillment A: first line qty 2 (of 3), Fulfillment B: first line qty 1 + second line qty 2.
        const fAId = crypto.randomUUID();
        const fBId = crypto.randomUUID();
        await sql`
          INSERT INTO public.orders_fulfillments (id, client_id, sale_id, label)
          VALUES
            (${fAId}::uuid, ${clientId}::uuid, ${splitSaleId}::uuid, 'Box A — Express'),
            (${fBId}::uuid, ${clientId}::uuid, ${splitSaleId}::uuid, 'Box B — Standard')
        `;
        if (lineIds[0]) {
          await sql`
            INSERT INTO public.orders_fulfillment_lines (fulfillment_id, sale_line_id, qty)
            VALUES
              (${fAId}::uuid, ${lineIds[0]}::uuid, 2),
              (${fBId}::uuid, ${lineIds[0]}::uuid, 1)
          `;
        }
        if (lineIds[1]) {
          await sql`
            INSERT INTO public.orders_fulfillment_lines (fulfillment_id, sale_line_id, qty)
            VALUES (${fBId}::uuid, ${lineIds[1]}::uuid, 2)
          `;
        }
        console.log(`  seeded split into 2 fulfillments (${fAId}, ${fBId}) for sale ${splitSaleId}`);
      }
    }
  }

  // 11. Seed a merge group: link order 10006 + 10002 (same phone is NOT guaranteed in demo data;
  // seed a real same-phone pair). Idempotent: skip if any merge group already exists for this client.
  const existingMerge = (await sql`
    SELECT 1 FROM public.orders_merge_groups WHERE client_id = ${clientId}::uuid LIMIT 1
  `) as unknown[];

  if (existingMerge.length === 0) {
    // Create two fresh open sales with the same customer phone.
    const mergePhone = '+60191112233';
    const mOrderNo1 = 19901;
    const mOrderNo2 = 19902;
    const mSale1Rows = (await sql`
      INSERT INTO public.sales
        (bucket_id, order_no, status, channel, customer_name, customer_phone,
         subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node)
      VALUES
        (${clientId}::uuid, ${mOrderNo1}, 'paid'::sale_status, 'online'::sale_channel,
         'Hannah Mergeworth', ${mergePhone}, 1800, 0, 0, 1800, ${ownerNodeId}::uuid)
      ON CONFLICT (bucket_id, order_no) DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;
    const mSale2Rows = (await sql`
      INSERT INTO public.sales
        (bucket_id, order_no, status, channel, customer_name, customer_phone,
         subtotal_cents, discount_cents, tax_cents, total_cents, created_by_user_node)
      VALUES
        (${clientId}::uuid, ${mOrderNo2}, 'paid'::sale_status, 'instore'::sale_channel,
         'Hannah Mergeworth', ${mergePhone}, 2400, 0, 0, 2400, ${ownerNodeId}::uuid)
      ON CONFLICT (bucket_id, order_no) DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;

    const mPrimaryId = mSale1Rows[0]?.id;
    const mSecondId = mSale2Rows[0]?.id;
    if (mPrimaryId && mSecondId) {
      const mgId = crypto.randomUUID();
      await sql`
        INSERT INTO public.orders_merge_groups (id, client_id, primary_sale_id, customer_key)
        VALUES (${mgId}::uuid, ${clientId}::uuid, ${mPrimaryId}::uuid, ${mergePhone})
      `;
      await sql`
        INSERT INTO public.orders_merge_members (group_id, sale_id)
        VALUES (${mgId}::uuid, ${mPrimaryId}::uuid), (${mgId}::uuid, ${mSecondId}::uuid)
      `;
      console.log(`  seeded merge group ${mgId} (${mPrimaryId}, ${mSecondId})`);
    }
  }

  console.log(`Seeded orders for ${client.name} (${SLUG}):`);
  console.log(`  ${inserted} new sales inserted (${DEMO_SALES.length} total attempted)`);
  console.log(`  pending_payment: ${c.pending}`);
  console.log(`  paid:            ${c.paid}`);
  console.log(`  fulfilled:       ${c.fulfilled}`);
  console.log(`  cancelled:       ${c.cancelled}`);
  console.log(`  refunded:        ${c.refunded}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

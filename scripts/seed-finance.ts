#!/usr/bin/env tsx
// Seed realistic Finance demo data for the "papa-s-saloon" client.
//
// Idempotent: re-running finds-or-creates the client + its L1 owner, re-enables
// the finance/pos/products modules, replaces the demo expense ledger, and — only
// if the client has no paid sales this month — seeds a handful of paid sales so
// the P&L revenue + channel breakdown render non-empty. Existing real sales are
// never touched or duplicated.
//
// Run: npm run seed:finance   (targets whatever DATABASE_URL .env points at).
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../netlify/functions/_shared/argon';

const SLUG = 'papa-s-saloon';

function ym(d: Date): { y: number; m: number } {
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}
function monthStartOffset(monthsAgo: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
}
// A day within the given month as 'YYYY-MM-DD'.
function dayOf(base: Date, day: number): string {
  const { y, m } = ym(base);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function tsOf(base: Date, day: number, hour = 12): string {
  return `${dayOf(base, day)}T${String(hour).padStart(2, '0')}:00:00Z`;
}
const rupees = (n: number) => Math.round(n * 100);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  // 1. Bootstrap admin (owner-of-record for created_by columns).
  const adminRows = (await sql`
    SELECT id FROM public.admins ORDER BY is_bootstrap DESC, created_at ASC LIMIT 1
  `) as Array<{ id: string }>;
  if (!adminRows[0]) throw new Error('no admin found — run `npm run bootstrap:admin` first');
  const adminId = adminRows[0].id;

  // 2. Find-or-create the client.
  let clientRows = (await sql`SELECT id FROM public.clients WHERE slug = ${SLUG} LIMIT 1`) as Array<{ id: string }>;
  if (!clientRows[0]) {
    clientRows = (await sql`
      INSERT INTO public.clients (slug, name, created_by, storefront_enabled)
      VALUES (${SLUG}, ${'Papa’s Saloon'}, ${adminId}, true)
      RETURNING id
    `) as Array<{ id: string }>;
    console.log(`✓ created client ${SLUG}`);
  } else {
    console.log(`• client ${SLUG} already exists`);
  }
  const clientId = clientRows[0]!.id;

  // 3. Ensure an L1 Owner node (needed for created_by + sales.created_by_user_node).
  let nodeRows = (await sql`
    SELECT id FROM public.user_nodes WHERE client_id = ${clientId}::uuid AND level_number = 1 LIMIT 1
  `) as Array<{ id: string }>;
  if (!nodeRows[0]) {
    const roleRows = (await sql`
      INSERT INTO public.client_roles (client_id, key, label, color)
      VALUES (${clientId}, 'owner', 'Owner', '#c9a26a')
      RETURNING id
    `) as Array<{ id: string }>;
    await sql`
      INSERT INTO public.client_levels (client_id, level_number, label, permissions)
      VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)
      ON CONFLICT DO NOTHING
    `;
    const email = `owner@${SLUG}.exsol.test`;
    nodeRows = (await sql`
      INSERT INTO public.user_nodes
        (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
      VALUES (${clientId}, NULL, 1, ${roleRows[0]!.id}, 'Papa (Owner)', ${email}, ${adminId})
      RETURNING id
    `) as Array<{ id: string }>;
    const pw = await hashPassword('papa-owner-demo-pw');
    await sql`
      INSERT INTO public.user_node_credentials
        (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
      VALUES (${clientId}, ${nodeRows[0]!.id}, ${email}, ${pw}, false, ${adminId})
      ON CONFLICT DO NOTHING
    `;
    console.log('✓ created L1 owner node + credential');
  }
  const ownerNodeId = nodeRows[0]!.id;

  // 4. Enable the modules the demo needs.
  for (const key of ['finance', 'pos', 'products']) {
    await sql`
      INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
      VALUES (${clientId}, ${key}, ${adminId})
      ON CONFLICT (client_id, product_key) DO NOTHING
    `;
  }
  console.log('✓ enabled finance + pos + products');

  // 5. Replace the demo expense ledger (last 3 months).
  await sql`DELETE FROM public.finance_expenses WHERE client_id = ${clientId}::uuid`;
  const months = [monthStartOffset(0), monthStartOffset(1), monthStartOffset(2)];
  // (category, rupees, note, day)
  const perMonth: Array<[string, number, string, number]> = [
    ['rent', 25000, 'Shop rent', 1],
    ['salaries', 46000, 'Stylist wages', 2],
    ['utilities', 4200, 'Electricity + water', 5],
    ['supplies', 6800, 'Shampoo, dyes, blades', 8],
    ['marketing', 3500, 'Instagram promo', 12],
    ['maintenance', 1900, 'Chair + AC servicing', 18],
  ];
  let expenseCount = 0;
  for (const base of months) {
    for (const [category, amt, note, day] of perMonth) {
      // Base-currency (INR) rows: amount_base_cents == amount_cents, rate 1.
      await sql`
        INSERT INTO public.finance_expenses
          (client_id, category, amount_cents, currency, amount_base_cents, fx_rate, note, incurred_on, created_by)
        VALUES (${clientId}::uuid, ${category}, ${rupees(amt)}, 'INR', ${rupees(amt)}, 1, ${note}, ${dayOf(base, day)}::date, ${ownerNodeId}::uuid)
      `;
      expenseCount++;
    }
  }

  // A foreign-currency purchase this month to demo the multicurrency ledger:
  // $250.00 imported clippers at 1 USD = ₹83 → ₹20,750.00 in base.
  const usdCents = 25000;
  const usdRate = 83;
  const usdBaseCents = Math.round((usdCents / 100) * usdRate * 100);
  await sql`
    INSERT INTO public.finance_expenses
      (client_id, category, amount_cents, currency, amount_base_cents, fx_rate, note, incurred_on, created_by)
    VALUES (${clientId}::uuid, 'equipment', ${usdCents}, 'USD', ${usdBaseCents}, ${usdRate},
            'Imported clippers (USD)', ${dayOf(months[0]!, 15)}::date, ${ownerNodeId}::uuid)
  `;
  expenseCount++;
  console.log(`✓ seeded ${expenseCount} expenses across 3 months (incl. 1 USD)`);

  // 5b. Recurring + milestone templates (idempotent replace).
  await sql`DELETE FROM public.finance_recurring_templates WHERE client_id = ${clientId}::uuid`;
  const nextMonth = monthStartOffset(-1); // first of next month
  // (category, rupees, cadence, next_run, note)
  const templates: Array<[string, number, string, string, string]> = [
    ['rent', 25000, 'monthly', dayOf(nextMonth, 1), 'Shop rent (auto)'],
    ['salaries', 46000, 'monthly', dayOf(nextMonth, 2), 'Stylist wages (auto)'],
    ['supplies', 2000, 'weekly', dayOf(nextMonth, 3), 'Weekly consumables'],
    ['equipment', 80000, 'once', dayOf(nextMonth, 10), 'New styling chair (milestone)'],
  ];
  for (const [category, amt, cadence, nextRun, note] of templates) {
    await sql`
      INSERT INTO public.finance_recurring_templates
        (client_id, category, amount_cents, currency, fx_rate, note, cadence, next_run, created_by)
      VALUES (${clientId}::uuid, ${category}, ${rupees(amt)}, 'INR', 1, ${note}, ${cadence}, ${nextRun}::date, ${ownerNodeId}::uuid)
    `;
  }
  console.log(`✓ seeded ${templates.length} recurring/milestone templates`);

  // 5c. Approvals: set a ₹50,000 threshold + one pending expense above it.
  const thresholdCents = rupees(50000);
  await sql`
    INSERT INTO public.finance_settings (client_id, approval_threshold_cents, updated_at)
    VALUES (${clientId}::uuid, ${thresholdCents}, now())
    ON CONFLICT (client_id) DO UPDATE
      SET approval_threshold_cents = EXCLUDED.approval_threshold_cents, updated_at = now()
  `;
  const pendingCents = rupees(62000);
  await sql`
    INSERT INTO public.finance_expenses
      (client_id, category, amount_cents, currency, amount_base_cents, fx_rate, note,
       incurred_on, created_by, approval_status)
    VALUES (${clientId}::uuid, 'equipment', ${pendingCents}, 'INR', ${pendingCents}, 1,
            'New salon POS terminal', ${dayOf(months[0]!, 20)}::date, ${ownerNodeId}::uuid, 'pending')
  `;
  console.log('✓ set ₹50,000 approval threshold + 1 pending expense');

  // 6. Seed demo revenue only if there are no paid sales this month (idempotent).
  const thisMonth = months[0]!;
  const paidThisMonth = (await sql`
    SELECT COUNT(*)::int AS n FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
      AND status IN ('paid','fulfilled')
      AND created_at >= ${dayOf(thisMonth, 1)}::date
      AND created_at <  (${dayOf(thisMonth, 1)}::date + interval '1 month')
  `) as Array<{ n: number }>;

  if (paidThisMonth[0]!.n === 0) {
    const maxRows = (await sql`
      SELECT COALESCE(MAX(order_no), 0)::int AS mx FROM public.sales WHERE bucket_id = ${clientId}::uuid
    `) as Array<{ mx: number }>;
    let orderNo = maxRows[0]!.mx + 1;
    // (source, channel, rupees, day)
    const demoSales: Array<['pos' | 'storefront', 'instore' | 'online' | 'pickup', number, number]> = [
      ['pos', 'instore', 800, 3],
      ['pos', 'instore', 1200, 6],
      ['pos', 'instore', 650, 9],
      ['pos', 'instore', 1500, 14],
      ['storefront', 'online', 2200, 4],
      ['storefront', 'pickup', 950, 11],
      ['storefront', 'online', 1800, 17],
    ];
    for (const [source, channel, amt, day] of demoSales) {
      // CHECK sales_source_attribution_consistent (mig 045): storefront (guest)
      // sales carry no creator node; pos sales are attributed to the owner.
      const creator = source === 'storefront' ? null : ownerNodeId;
      await sql`
        INSERT INTO public.sales
          (bucket_id, order_no, status, channel, customer_name, customer_phone,
           subtotal_cents, discount_cents, tax_cents, total_cents,
           created_by_user_node, source, created_at)
        VALUES
          (${clientId}::uuid, ${orderNo}, 'paid', ${channel}::public.sale_channel,
           'Walk-in Customer', '+919000000000',
           ${rupees(amt)}, 0, 0, ${rupees(amt)},
           ${creator}::uuid, ${source}, ${tsOf(thisMonth, day)}::timestamptz)
      `;
      orderNo++;
    }
    console.log(`✓ seeded ${demoSales.length} paid sales (pos + storefront) this month`);
  } else {
    console.log(`• ${paidThisMonth[0]!.n} paid sales already exist this month — skipping revenue seed`);
  }

  console.log(`\nDone. Open /c/${SLUG}/finance to view the P&L.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

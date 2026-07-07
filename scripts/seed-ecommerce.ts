// Seed demo data for the ecommerce/storefront depth features against a real
// storefront-enabled client (Papa's Saloon in the dev branch). Idempotent —
// safe to re-run. Grows one block per depth feature.
//
//   npm run seed:ecommerce
//
// No-ops cleanly if no storefront-enabled client exists yet (prints a hint).

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function pickStorefrontClient(): Promise<{ id: string; slug: string; name: string } | null> {
  const rows = (await sql`
    SELECT id, slug, name FROM public.clients
    WHERE storefront_enabled = true
    ORDER BY name ILIKE 'papa%' DESC, created_at ASC
    LIMIT 1
  `) as Array<{ id: string; slug: string; name: string }>;
  return rows[0] ?? null;
}

async function seedCoupons(clientId: string): Promise<number> {
  const now = Date.now();
  const iso = (d: number) => new Date(d).toISOString();
  const coupons = [
    { code: 'WELCOME10', discount_type: 'percent', discount_value: 10, min_order_cents: 0, max_redemptions: null, per_customer_limit: 1, starts_at: null, expires_at: null, active: true },
    { code: 'FLAT200', discount_type: 'fixed', discount_value: 20000, min_order_cents: 100000, max_redemptions: 50, per_customer_limit: null, starts_at: null, expires_at: iso(now + 30 * 864e5), active: true },
    { code: 'DIWALI25', discount_type: 'percent', discount_value: 25, min_order_cents: 50000, max_redemptions: 200, per_customer_limit: 2, starts_at: null, expires_at: iso(now + 14 * 864e5), active: true },
    { code: 'EXPIRED5', discount_type: 'percent', discount_value: 5, min_order_cents: 0, max_redemptions: null, per_customer_limit: null, starts_at: null, expires_at: iso(now - 864e5), active: true },
  ];
  let n = 0;
  for (const c of coupons) {
    const res = (await sql`
      INSERT INTO public.coupons
        (client_id, code, discount_type, discount_value, min_order_cents, max_redemptions, per_customer_limit, starts_at, expires_at, active)
      VALUES (${clientId}, ${c.code}, ${c.discount_type}, ${c.discount_value}, ${c.min_order_cents},
              ${c.max_redemptions}, ${c.per_customer_limit}, ${c.starts_at}, ${c.expires_at}, ${c.active})
      ON CONFLICT (client_id, lower(code)) DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;
    if (res[0]) n++;
  }
  return n;
}

async function seedReviews(clientId: string): Promise<number> {
  // Idempotent-ish: only seed if this client has no reviews yet.
  const existing = (await sql`SELECT count(*)::int AS n FROM public.product_reviews WHERE client_id = ${clientId}`) as Array<{ n: number }>;
  if (Number(existing[0]!.n) > 0) return 0;

  const seed = [
    { kind: 'review', rating: 5, author_name: 'Asha M.', body: 'Best fade in town, and the coffee while waiting is a lovely touch.', answer: null, status: 'approved' },
    { kind: 'review', rating: 4, author_name: 'Rahul P.', body: 'Great service. Wish they had more evening slots.', answer: null, status: 'approved' },
    { kind: 'review', rating: 5, author_name: 'Neha K.', body: 'Booked online, in and out in 30 mins. Highly recommend.', answer: null, status: 'approved' },
    { kind: 'question', rating: null, author_name: 'Vikram S.', body: 'Do you accept walk-ins on weekends?', answer: 'Yes! Weekends 10am–7pm, though booking is faster.', status: 'approved' },
    { kind: 'review', rating: 2, author_name: 'Anon', body: 'Waited too long past my slot.', answer: null, status: 'pending' },
    { kind: 'question', rating: null, author_name: 'Priya', body: 'Is parking available nearby?', answer: null, status: 'pending' },
  ];
  let n = 0;
  for (const r of seed) {
    await sql`
      INSERT INTO public.product_reviews
        (client_id, kind, rating, author_name, body, answer, status, moderated_at)
      VALUES (${clientId}, ${r.kind}, ${r.rating}, ${r.author_name}, ${r.body}, ${r.answer}, ${r.status},
              ${r.status === 'approved' ? new Date().toISOString() : null})
    `;
    n++;
  }
  return n;
}

async function seedBundles(clientId: string): Promise<number> {
  const existing = (await sql`
    SELECT count(*)::int AS n FROM public.product_bundle_items bi
    JOIN public.products p ON p.id = bi.bundle_product_id
    WHERE p.client_id = ${clientId}
  `) as Array<{ n: number }>;
  if (Number(existing[0]!.n) > 0) return 0;

  // Two cheapest live storefront products become a combo priced ~15% off.
  const comps = (await sql`
    SELECT id, COALESCE(sale_price_cents, price_cents) AS price
    FROM public.products
    WHERE client_id = ${clientId} AND deleted_at IS NULL AND status = 'active' AND storefront_visible = true
      AND NOT EXISTS (SELECT 1 FROM public.product_bundle_items bi WHERE bi.bundle_product_id = products.id)
    ORDER BY price ASC
    LIMIT 2
  `) as Array<{ id: string; price: number }>;
  if (comps.length < 2) return 0;

  const sum = comps.reduce((a, c) => a + Number(c.price), 0);
  const price = Math.round(sum * 0.85);
  const bundle = (await sql`
    INSERT INTO public.products (client_id, type, name, price_cents, status, storefront_visible, pos_visible)
    VALUES (${clientId}, 'physical', 'Combo Deal', ${price}, 'active', true, true)
    RETURNING id
  `) as Array<{ id: string }>;
  let pos = 0;
  for (const c of comps) {
    await sql`
      INSERT INTO public.product_bundle_items (bundle_product_id, component_product_id, qty, position)
      VALUES (${bundle[0]!.id}, ${c.id}, 1, ${pos++})
    `;
  }
  return 1;
}

async function seedTax(clientId: string): Promise<boolean> {
  const res = (await sql`
    INSERT INTO public.client_tax_config (client_id, enabled, rate_bps, label, inclusive)
    VALUES (${clientId}, true, 1800, 'GST', false)
    ON CONFLICT (client_id) DO NOTHING
    RETURNING client_id
  `) as Array<{ client_id: string }>;
  return res.length > 0;
}

async function seedCms(clientId: string): Promise<boolean> {
  const sections = {
    hero: { enabled: true, heading: "Welcome to Papa's Saloon", subheading: 'Fresh cuts, booked in seconds.', ctaLabel: 'Book now', ctaHref: '/book' },
    banners: [{ text: 'Free head massage on orders over ₹500' }, { text: 'Walk-ins welcome, 10am–7pm' }],
  };
  const res = (await sql`
    INSERT INTO public.storefront_cms (client_id, sections, published)
    VALUES (${clientId}, ${JSON.stringify(sections)}::jsonb, true)
    ON CONFLICT (client_id) DO NOTHING
    RETURNING client_id
  `) as Array<{ client_id: string }>;
  return res.length > 0;
}

async function main() {
  const host = (process.env.DATABASE_URL ?? '').match(/@([^/]+)/)?.[1] ?? 'unknown';
  console.log(`[seed-ecommerce] DB host: ${host}`);

  const client = await pickStorefrontClient();
  if (!client) {
    console.log('[seed-ecommerce] No storefront-enabled client found. Enable a storefront first, then re-run.');
    return;
  }
  console.log(`[seed-ecommerce] Seeding for "${client.name}" (/${client.slug})`);

  const coupons = await seedCoupons(client.id);
  console.log(`[seed-ecommerce] coupons: +${coupons} new`);

  const reviews = await seedReviews(client.id);
  console.log(`[seed-ecommerce] reviews: +${reviews} new`);

  const bundles = await seedBundles(client.id);
  console.log(`[seed-ecommerce] bundles: +${bundles} new`);

  const tax = await seedTax(client.id);
  console.log(`[seed-ecommerce] tax: ${tax ? 'enabled GST 18%' : 'already set'}`);

  const cms = await seedCms(client.id);
  console.log(`[seed-ecommerce] storefront CMS: ${cms ? 'published hero + banners' : 'already set'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

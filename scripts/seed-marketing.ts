#!/usr/bin/env tsx
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  const c = (await sql`SELECT id FROM public.clients WHERE slug = 'papa-s-saloon' LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) throw new Error('demo tenant papa-s-saloon not found');
  const clientId = c[0].id;

  const admin = (await sql`SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
            VALUES (${clientId}, 'marketing', ${admin[0]?.id ?? null}) ON CONFLICT (client_id, product_key) DO NOTHING`;

  // A draft campaign
  await sql`INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, status)
            VALUES (${clientId}, 'Weekend Special', '20% off all services this weekend',
                    '<h2>Weekend Special</h2><p>Book now and save 20%.</p>', 'all', 'draft')`;

  // Seed demo emailable customers (idempotent)
  const demoCustomers = [
    { name: 'Aisha Khan', phone: '+919812300001', email: 'aisha.demo@example.com' },
    { name: 'Rohan Mehta', phone: '+919812300002', email: 'rohan.demo@example.com' },
    { name: 'Priya Nair', phone: '+919812300003', email: 'priya.demo@example.com' },
  ];
  for (const cust of demoCustomers) {
    await sql`INSERT INTO public.crm_customers (client_id, display_name, phone, email, dedupe_key, source, first_seen, last_seen)
              VALUES (${clientId}, ${cust.name}, ${cust.phone}, ${cust.email}, ${'phone:' + cust.phone}, 'pos', now(), now())
              ON CONFLICT (client_id, dedupe_key) DO NOTHING`;
  }

  // A sent campaign + a couple of send-log rows (from real emailable crm_customers if any)
  const sent = (await sql`INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, status, sent_at)
            VALUES (${clientId}, 'New Year Greetings', 'Happy New Year from Papa''s Saloon',
                    '<p>Wishing you a great year!</p>', 'all', 'sent', now()) RETURNING id`) as Array<{ id: string }>;
  const custs = (await sql`SELECT id, email FROM public.crm_customers WHERE client_id = ${clientId} AND email IS NOT NULL LIMIT 3`) as Array<{ id: string; email: string }>;
  for (const cust of custs) {
    await sql`INSERT INTO public.campaign_sends (client_id, campaign_id, customer_id, recipient_email, status)
              VALUES (${clientId}, ${sent[0]!.id}, ${cust.id}, ${cust.email}, 'logged')`;
  }
  console.log(`✓ Marketing enabled + seeded 2 campaigns (${custs.length} send-log rows) for papa-s-saloon (${clientId})`);
}
main().catch((e) => { console.error(e); process.exit(1); });

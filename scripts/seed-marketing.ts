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

  // A draft SMS campaign (mock channel — sends log, don't deliver)
  await sql`INSERT INTO public.marketing_campaigns (client_id, name, subject, body_html, audience, channel, status)
            VALUES (${clientId}, 'Appointment Reminder (SMS)', 'Your slot is coming up',
                    '<p>See you soon at Papa''s Saloon!</p>', 'recent_30d', 'sms', 'draft')`;

  // A draft A/B email campaign — two subject lines, 50/50 split
  await sql`INSERT INTO public.marketing_campaigns (client_id, name, subject, subject_b, is_ab, ab_split, body_html, audience, channel, status)
            VALUES (${clientId}, 'Loyalty Offer (A/B)', 'A little something for you',
                    'Your exclusive 25% reward inside', true, 50,
                    '<h2>Thanks for being a regular</h2><p>Enjoy 25% off your next visit.</p>', 'all', 'email', 'draft')`;

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

  // ROI demo: realised storefront sales attributed to the sent campaign — same
  // emails as recipients, purchased within the 14-day attribution window.
  let attributed = 0;
  for (const cust of custs.slice(0, 2)) {
    const orderNo = Math.floor(1 + Math.random() * 2_000_000_000);
    await sql`INSERT INTO public.sales
      (bucket_id, order_no, status, channel, customer_name, customer_phone, customer_email,
       subtotal_cents, discount_cents, tax_cents, total_cents, source, created_by_user_node, created_at)
      VALUES (${clientId}, ${orderNo}, 'paid', 'online', 'Campaign Buyer', '+919812309999', ${cust.email},
              62000, 0, 0, 62000, 'storefront', NULL, now())`;
    attributed++;
  }
  // Webhook spine demo: an endpoint + a trigger (abandoned_cart → the A/B campaign)
  const abCamp = (await sql`SELECT id FROM public.marketing_campaigns WHERE client_id = ${clientId} AND name = 'Loyalty Offer (A/B)' LIMIT 1`) as Array<{ id: string }>;
  const ep = (await sql`
    INSERT INTO public.marketing_webhook_endpoints (client_id, label, token, secret)
    VALUES (${clientId}, 'Storefront events', 'demo-webhook-token-papas-saloon', 'demo-secret-not-for-production')
    ON CONFLICT (token) DO NOTHING RETURNING id`) as Array<{ id: string }>;
  if (ep[0] && abCamp[0]) {
    await sql`INSERT INTO public.marketing_webhook_triggers (client_id, event_type, campaign_id)
              VALUES (${clientId}, 'abandoned_cart', ${abCamp[0].id})`;
  }
  // GDPR demo: a consent record for the first demo customer
  if (custs[0]?.email) {
    await sql`INSERT INTO public.marketing_consent_log (client_id, email, channel, granted, source)
              VALUES (${clientId}, ${custs[0].email}, 'email', true, 'signup')`;
  }

  // Social scheduler demo: one upcoming scheduled post + one already posted
  await sql`INSERT INTO public.marketing_social_posts (client_id, provider, content, scheduled_for, status)
            VALUES (${clientId}, 'instagram', 'Fresh fades all week ✂️ Book your slot!', now() + interval '2 days', 'scheduled')`;
  await sql`INSERT INTO public.marketing_social_posts (client_id, provider, content, scheduled_for, status, posted_at, provider_ref)
            VALUES (${clientId}, 'facebook', 'Thanks for a great weekend, everyone!', now() - interval '1 day', 'posted', now() - interval '1 day', 'mock_facebook_seed12345678')`;
  console.log(`✓ Marketing enabled + seeded campaigns (${custs.length} send-log rows, ${attributed} attributed sales) + webhook endpoint/trigger + consent record for papa-s-saloon (${clientId})`);
}
main().catch((e) => { console.error(e); process.exit(1); });

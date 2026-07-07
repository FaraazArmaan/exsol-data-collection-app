#!/usr/bin/env tsx
import { neon } from '@neondatabase/serverless';
import { refreshCustomers } from '../src/modules/crm/lib/refresh';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  const c = (await sql`SELECT id FROM public.clients WHERE slug = 'papa-s-saloon' LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) throw new Error('demo tenant papa-s-saloon not found — seed POS/Booking first');
  const clientId = c[0].id;

  // Enable the crm product for the demo tenant (idempotent).
  const admin = (await sql`SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
            VALUES (${clientId}, 'crm', ${admin[0]?.id ?? null}) ON CONFLICT (client_id, product_key) DO NOTHING`;

  const n = await refreshCustomers(sql, clientId);
  console.log(`✓ CRM enabled + seeded ${n} customers for papa-s-saloon (${clientId})`);

  // Demo leads for the Leads inbox (idempotent replace of public_form leads).
  await sql`DELETE FROM public.crm_leads WHERE client_id = ${clientId}::uuid AND source = 'public_form'`;
  const leads: Array<[string, string | null, string | null, string | null]> = [
    ['Priya Nair', 'priya@example.com', '+919876540011', 'Do you offer bridal packages?'],
    ['Rahul Verma', null, '+919876540022', 'What are your Sunday hours?'],
    ['Anita Desai', 'anita@example.com', null, 'Interested in a monthly membership.'],
  ];
  for (const [name, email, phone, message] of leads) {
    await sql`INSERT INTO public.crm_leads (client_id, name, email, phone, message, source, status)
              VALUES (${clientId}::uuid, ${name}, ${email}, ${phone}, ${message}, 'public_form', 'new')`;
  }
  console.log(`✓ seeded ${leads.length} demo leads`);

  // A connected social provider (mock) so the Social tab demos non-empty.
  await sql`
    INSERT INTO public.crm_social_connections (client_id, provider, status, account_label, connected_at, updated_at)
    VALUES (${clientId}::uuid, 'google', 'connected', 'owner@papa-s-saloon.example', now(), now())
    ON CONFLICT (client_id, provider) DO UPDATE
      SET status = 'connected', account_label = EXCLUDED.account_label, updated_at = now()
  `;
  console.log('✓ connected 1 demo social provider (google, mock)');
}
main().catch((e) => { console.error(e); process.exit(1); });

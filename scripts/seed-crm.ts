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
}
main().catch((e) => { console.error(e); process.exit(1); });

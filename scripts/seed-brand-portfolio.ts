#!/usr/bin/env tsx
// Seed a published Brand Portfolio Site for papa-s-saloon:
//  - enables the 'brand-portfolio' product (so the editor + module gate work)
//  - upserts brand_site_config with all sections on + a realistic tagline/contact
//    and published=true, so /site/papa-s-saloon renders a full branded page.
// Run: npm run seed:brand-portfolio
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const SLUG = 'papa-s-saloon';

const SECTIONS = {
  hero: { enabled: true, tagline: 'Premium grooming & styling in the heart of town.' },
  products: { enabled: true },
  gallery: { enabled: true },
  booking: { enabled: true },
  contact: {
    enabled: true,
    email: 'hello@papas-saloon.example',
    phone: '+91 98765 43210',
    address: '12 High Street, Bengaluru 560001',
  },
};

async function main(): Promise<void> {
  const rows = (await sql`SELECT id FROM public.clients WHERE slug = ${SLUG} LIMIT 1`) as Array<{ id: string }>;
  if (!rows[0]) {
    console.error(`Client "${SLUG}" not found in this database. Create it first, then re-run.`);
    process.exit(1);
  }
  const clientId = rows[0].id;

  const admin = (await sql`SELECT id FROM public.admins ORDER BY is_bootstrap DESC LIMIT 1`) as Array<{ id: string }>;
  const adminId = admin[0]?.id ?? null;

  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'brand-portfolio', ${adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;

  await sql`
    INSERT INTO public.brand_site_config (client_id, sections, published, updated_at)
    VALUES (${clientId}, ${JSON.stringify(SECTIONS)}::jsonb, true, now())
    ON CONFLICT (client_id) DO UPDATE
      SET sections = EXCLUDED.sections, published = true, updated_at = now()
  `;

  console.log(`Published Brand Portfolio Site for ${SLUG} (${clientId}); enabled brand-portfolio product.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

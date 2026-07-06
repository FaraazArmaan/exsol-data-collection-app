// Seed the Data Collection + Catalog recombination for a workspace (default:
// papa-s-saloon).
//   npm run seed:data-collection            # papa-s-saloon
//   npm run seed:data-collection some-slug  # any client by slug
//
// Idempotent: enables the product chain (products + pos + catalog +
// data-collection), sets a contact phone/email for the catalog CTA (without
// clobbering an owner-set value), and ensures one live onboarding token exists.
// Prints the public /catalog and /onboard URLs so the golden flows are clickable.
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set (run via `npm run seed:data-collection`, which loads .env).');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

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

  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key)
    VALUES (${clientId}::uuid, 'products'), (${clientId}::uuid, 'pos'),
           (${clientId}::uuid, 'catalog'), (${clientId}::uuid, 'data-collection')
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;

  await sql`
    UPDATE public.clients
    SET contact_phone = COALESCE(contact_phone, '+91 98765 43210'),
        contact_email = COALESCE(contact_email, 'hello@papas-saloon.example')
    WHERE id = ${clientId}::uuid
  `;

  const live = (await sql`
    SELECT token FROM public.onboard_tokens
    WHERE client_id = ${clientId}::uuid AND used_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1
  `) as Array<{ token: string }>;
  let token = live[0]?.token;
  let fresh = false;
  if (!token) {
    token = randomUUID();
    await sql`
      INSERT INTO public.onboard_tokens (client_id, token, expires_at)
      VALUES (${clientId}::uuid, ${token}, now() + interval '7 days')
    `;
    fresh = true;
  }

  console.log(`Seeded Data Collection + Catalog for ${client.name} (${SLUG}):`);
  console.log(`  products enabled: products, pos, catalog, data-collection`);
  console.log(`  contact CTA:      set (phone + email)`);
  console.log(`  onboarding token: ${token} (${fresh ? 'new' : 'existing'})`);
  console.log('');
  console.log(`  Catalog:  /catalog/${SLUG}`);
  console.log(`  Onboard:  /onboard/${token}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

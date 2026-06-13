// Integration-test helpers for /api/pos/* endpoints.
//
// Each test calls `seedClientWithProductsEnabled()` to mint a fresh Client +
// L1 Owner + bucket-user credential + signed JWT cookie. Unique slugs prevent
// inter-test collisions; teardown is implicit (rows live in the test DB).
//
// Schema realities the seed honors:
//   • clients(slug, name, created_by) — created_by FKs admins(id)
//   • client_roles(id, client_id, key, label, color, …) — `key` and `label`, no `name`
//   • client_levels(client_id, level_number, label, permissions) — no created_by
//   • user_nodes(client_id, parent_id, level_number, role_id, display_name,
//       email, created_by_admin) — created_by_admin nullable since mig 023
//   • user_node_credentials(client_id, user_node_id, email, password_hash, …)
//   • client_enabled_products(client_id, product_key) — PK (client_id, product_key)
//   • products(client_id, type, name, price_cents, sale_price_cents,
//       pos_visible (mig 039), status, …) — `bucket_id` only exists on `sales`.

import { neon } from '@neondatabase/serverless';
import { mintBucketUserSession } from '../../netlify/functions/_shared/session';
import { hashPassword } from '../../netlify/functions/_shared/argon';

const sql = neon(process.env.DATABASE_URL!);

export interface PosTestCtx {
  clientId: string;
  userNodeId: string;
  cookie: string;
  adminId: string;
}

let cachedAdminId: string | null = null;

async function ensureBootstrapAdmin(): Promise<string> {
  if (cachedAdminId) return cachedAdminId;
  // Try existing bootstrap admin first; if none, create a dedicated test admin.
  const found = (await sql`
    SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1
  `) as Array<{ id: string }>;
  if (found[0]) {
    cachedAdminId = found[0].id;
    return cachedAdminId;
  }
  const hash = await hashPassword('pos-test-admin-pw');
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES ('pos-test-admin@exsol.test', ${hash}, 'POS Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}
    RETURNING id
  `) as Array<{ id: string }>;
  cachedAdminId = rows[0]!.id;
  return cachedAdminId;
}

export async function seedClientWithProductsEnabled(): Promise<PosTestCtx> {
  const adminId = await ensureBootstrapAdmin();

  // 1. Client with unique slug per call.
  const slug = `pos-test-${Math.random().toString(36).slice(2, 10)}`;
  const clientRows = (await sql`
    INSERT INTO public.clients (slug, name, created_by)
    VALUES (${slug}, 'POS Test', ${adminId})
    RETURNING id
  `) as Array<{ id: string }>;
  const clientId = clientRows[0]!.id;

  // 2. Owner role for L1.
  const roleRows = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}, 'owner', 'Owner', '#3b82f6')
    RETURNING id
  `) as Array<{ id: string }>;
  const roleId = roleRows[0]!.id;

  // 3. L1 row with empty permissions JSONB (tests grant explicitly).
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, permissions)
    VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)
  `;

  // 4. L1 Owner user_node.
  const email = `pos-test-owner-${slug}@exsol.test`;
  const nodeRows = (await sql`
    INSERT INTO public.user_nodes
      (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientId}, NULL, 1, ${roleId}, 'POS Test Owner', ${email}, ${adminId})
    RETURNING id
  `) as Array<{ id: string }>;
  const userNodeId = nodeRows[0]!.id;

  // 5. user_node_credentials — required so requireBucketUser() can hydrate.
  const hash = await hashPassword('pos-test-owner-pw');
  await sql`
    INSERT INTO public.user_node_credentials
      (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
    VALUES (${clientId}, ${userNodeId}, ${email}, ${hash}, false, ${adminId})
  `;

  // 6. Enable both modules. PK is (client_id, product_key) → idempotent guard.
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'products', ${adminId}),
           (${clientId}, 'pos', ${adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;

  // 7. Mint a real bucket-user JWT (same code path as production login).
  const token = await mintBucketUserSession({ sub: userNodeId, email, client_id: clientId });
  return { clientId, userNodeId, adminId, cookie: `bu_session=${token}` };
}

export interface SeedProductInput {
  name: string;
  price_cents?: number;
  sale_price_cents?: number | null;
  pos_visible?: boolean;
  status?: 'active' | 'draft' | 'archived';
  category_id?: string | null;
}

export async function seedProducts(
  clientId: string,
  products: ReadonlyArray<SeedProductInput>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const p of products) {
    const priceCents = p.price_cents ?? p.sale_price_cents ?? 100;
    const salePriceCents = p.sale_price_cents ?? null;
    const posVisible = p.pos_visible ?? true;
    const status = p.status ?? 'active';
    const categoryId = p.category_id ?? null;
    const rows = (await sql`
      INSERT INTO public.products
        (client_id, type, name, price_cents, sale_price_cents,
         pos_visible, status, category_id)
      VALUES
        (${clientId}, 'physical', ${p.name}, ${priceCents}, ${salePriceCents},
         ${posVisible}, ${status}::product_status, ${categoryId})
      RETURNING id
    `) as Array<{ id: string }>;
    ids.push(rows[0]!.id);
  }
  return ids;
}

export async function disableProductsForClient(clientId: string): Promise<void> {
  await sql`
    DELETE FROM public.client_enabled_products
    WHERE client_id = ${clientId} AND product_key = 'products'
  `;
}

export async function grantPerms(
  clientId: string,
  levelNumber: number,
  keys: readonly string[],
): Promise<void> {
  const perms: Record<string, true> = Object.fromEntries(keys.map((k) => [k, true]));
  await sql`
    UPDATE public.client_levels
       SET permissions = ${JSON.stringify(perms)}::jsonb
     WHERE client_id = ${clientId} AND level_number = ${levelNumber}
  `;
}

export function makeBucketUserRequest(
  ctx: PosTestCtx,
  method: string,
  path: string,
  body?: unknown,
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { cookie: ctx.cookie, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import onboardClientHandler from '../../netlify/functions/onboard-client';

const ADMIN_EMAIL = 'onboard-test@example.com';
const ADMIN_PASSWORD = 'onboard-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
const createdClients: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Onboard Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}, display_name = 'Onboard Test Admin'
  `;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  cookie = lr.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}`; } catch { /* */ }
  }
});

function fullBody(name: string) {
  const uniqEmail = `owner-${Date.now()}-${Math.floor(Math.random()*1e6)}@example.com`;
  return {
    name,
    enabled_products: ['saloon-booking'],
    roles: [
      { key: 'owner', label: 'Owner', color: '#3b82f6' },
      { key: 'staff', label: 'Staff', color: '#22c55e' },
    ],
    levels: [
      { level_number: 1, label: 'Primary', allowed_role_keys: ['owner'] },
      { level_number: 2, label: 'Secondary', allowed_role_keys: ['staff'] },
    ],
    cardinality_rules: [
      { parent_role_key: null, child_role_key: 'owner', max_children: 1 },
      { parent_role_key: 'owner', child_role_key: 'staff', max_children: 10 },
    ],
    owner: {
      display_name: 'Owner User',
      email: uniqEmail,
      temp_password: 'onboard-temp-pw-1',
    },
  };
}

async function call(body: unknown) {
  return onboardClientHandler(
    new Request('http://localhost/api/onboard-client', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    }), CTX,
  );
}

describe('onboard-client', () => {
  test('happy path creates client + products + roles + levels + cardinality + owner + credential', async () => {
    const body = fullBody(`Onboard Happy ${Date.now()}`);
    const r = await call(body);
    expect(r.status).toBe(201);
    const out = await r.json() as { client: { id: string; slug: string; name: string } };
    createdClients.push(out.client.id);
    expect(out.client.name).toBe(body.name);
    expect(out.client.slug).toMatch(/^onboard-happy-/);

    // Verify all FKs landed.
    const c = (await sql`SELECT id FROM public.clients WHERE id = ${out.client.id}::uuid`) as unknown[];
    expect(c.length).toBe(1);
    const enabled = (await sql`SELECT product_key FROM public.client_enabled_products WHERE client_id = ${out.client.id}::uuid`) as { product_key: string }[];
    expect(enabled.map((p) => p.product_key)).toEqual(['saloon-booking']);
    const roles = (await sql`SELECT key, label FROM public.client_roles WHERE client_id = ${out.client.id}::uuid ORDER BY key`) as { key: string; label: string }[];
    expect(roles.length).toBe(2);
    expect(roles.find((r) => r.key === 'owner')?.label).toBe('Owner');
    const levels = (await sql`SELECT level_number FROM public.client_levels WHERE client_id = ${out.client.id}::uuid ORDER BY level_number`) as { level_number: number }[];
    expect(levels.map((l) => l.level_number)).toEqual([1, 2]);
    const card = (await sql`SELECT max_children FROM public.client_cardinality_rules WHERE client_id = ${out.client.id}::uuid ORDER BY max_children`) as { max_children: number }[];
    expect(card.length).toBe(2);
    const nodes = (await sql`SELECT display_name, email, level_number FROM public.user_nodes WHERE client_id = ${out.client.id}::uuid`) as { display_name: string; email: string; level_number: number }[];
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.display_name).toBe(body.owner.display_name);
    expect(nodes[0]!.level_number).toBe(1);
    const cred = (await sql`SELECT must_change_password, temp_password_plain FROM public.user_node_credentials WHERE client_id = ${out.client.id}::uuid`) as { must_change_password: boolean; temp_password_plain: string }[];
    expect(cred[0]!.must_change_password).toBe(true);
    expect(cred[0]!.temp_password_plain).toBe(body.owner.temp_password);
  });

  test('minimum body (auto-seed roles + levels) creates working client', async () => {
    const uniqEmail = `min-${Date.now()}@example.com`;
    const r = await call({
      name: `Onboard Min ${Date.now()}`,
      enabled_products: [],
      roles: [],
      levels: [],
      cardinality_rules: [],
      owner: { display_name: 'Min Owner', email: uniqEmail, temp_password: 'min-pw-1234' },
    });
    expect(r.status).toBe(201);
    const out = await r.json() as { client: { id: string } };
    createdClients.push(out.client.id);
    const roles = (await sql`SELECT key FROM public.client_roles WHERE client_id = ${out.client.id}::uuid`) as { key: string }[];
    expect(roles.map((r) => r.key)).toEqual(['owner']);
    const levels = (await sql`SELECT level_number FROM public.client_levels WHERE client_id = ${out.client.id}::uuid`) as { level_number: number }[];
    expect(levels.map((l) => l.level_number)).toEqual([1]);
    const nodes = (await sql`SELECT level_number FROM public.user_nodes WHERE client_id = ${out.client.id}::uuid`) as { level_number: number }[];
    expect(nodes.length).toBe(1);
    expect(nodes[0]!.level_number).toBe(1);
  });

  test('invalid_reference rolls back — level allowed_role_keys references nonexistent role', async () => {
    const uniqName = `Onboard Bad Ref ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const r = await call({
      name: uniqName,
      enabled_products: [],
      roles: [{ key: 'owner', label: 'Owner', color: '#3b82f6' }],
      levels: [{ level_number: 1, allowed_role_keys: ['nonexistent'] }],
      cardinality_rules: [],
      owner: { display_name: 'X', email: `bad-${Date.now()}@example.com`, temp_password: 'bad-pw-1234' },
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string; details: { section: string } } };
    expect(body.error.code).toBe('invalid_reference');
    expect(body.error.details.section).toBe('levels');
    // No client row should exist for THIS submission's derived slug.
    // Asserting by name (precise) instead of by global count (race-prone in parallel suites).
    const leak = (await sql`SELECT id FROM public.clients WHERE name = ${uniqName} LIMIT 1`) as { id: string }[];
    expect(leak.length).toBe(0);
  });

  test('cardinality_violation rolls back — rule + owner conflict', async () => {
    const uniqName = `Onboard Card Viol ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const r = await call({
      name: uniqName,
      enabled_products: [],
      roles: [{ key: 'owner', label: 'Owner', color: '#3b82f6' }],
      levels: [{ level_number: 1, allowed_role_keys: ['owner'] }],
      // Cap = 0 owners at top, then try to seed one.
      cardinality_rules: [{ parent_role_key: null, child_role_key: 'owner', max_children: 0 }],
      owner: { display_name: 'X', email: `cv-${Date.now()}@example.com`, temp_password: 'cv-pw-1234' },
    });
    expect(r.status).toBe(409);
    const body = await r.json() as { error: { code: string; details: { section: string } } };
    expect(body.error.code).toBe('cardinality_violation');
    expect(body.error.details.section).toBe('owner');
    const leak = (await sql`SELECT id FROM public.clients WHERE name = ${uniqName} LIMIT 1`) as { id: string }[];
    expect(leak.length).toBe(0);
  });

  test('admin attribution: created_by_admin set on client + user_node + credential', async () => {
    const r = await call(fullBody(`Onboard Attrib ${Date.now()}`));
    expect(r.status).toBe(201);
    const out = await r.json() as { client: { id: string } };
    createdClients.push(out.client.id);
    const node = (await sql`SELECT created_by_admin FROM public.user_nodes WHERE client_id = ${out.client.id}::uuid`) as { created_by_admin: string | null }[];
    const cred = (await sql`SELECT created_by_admin FROM public.user_node_credentials WHERE client_id = ${out.client.id}::uuid`) as { created_by_admin: string | null }[];
    expect(node[0]!.created_by_admin).not.toBeNull();
    expect(cred[0]!.created_by_admin).not.toBeNull();
  });

  test('non-admin (no cookie) → 401 unauthorized', async () => {
    const r = await onboardClientHandler(
      new Request('http://localhost/api/onboard-client', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullBody('No Auth')),
      }), CTX,
    );
    expect(r.status).toBe(401);
  });
});

// tests/integration/client-levels-create-defaults.test.ts
//
// Verify POST /api/client-levels writes permission defaults correctly:
// L1 = all keys for enabled products true; L2+ = empty {}.

import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import clientsHandler from '../../netlify/functions/clients';
import clientLevelsHandler from '../../netlify/functions/client-levels';

const ADMIN_EMAIL = `level-defaults-test-${Date.now()}@example.com`;
const ADMIN_PASSWORD = 'level-defaults-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let clientId: string;
const created: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Level Defaults Test', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
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
  const cr = await clientsHandler(
    new Request('http://localhost/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: `Level Defaults ${Date.now()}-${Math.random()}` }),
    }), CTX,
  );
  clientId = (await cr.json() as { client: { id: string } }).client.id;
  created.push(clientId);
});

afterAll(async () => {
  for (const id of created) { try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ } }
});

describe('POST /api/client-levels — permission defaults', () => {
  test('L1 returns a level with all platform keys true (no products enabled)', async () => {
    const r = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 1, label: 'Top' }),
      }), CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { level: { permissions: Record<string, boolean> } };
    const keys = Object.keys(body.level.permissions);
    // At minimum, platform surfaces × verbs = 16 keys, all true.
    expect(keys.length).toBeGreaterThanOrEqual(16);
    for (const k of keys) {
      expect(body.level.permissions[k]).toBe(true);
    }
    // All platform keys present.
    expect(keys).toContain('_platform.users.edit');
    expect(keys).toContain('_platform.users.view');
    expect(keys).toContain('_platform.structure.view');
    expect(keys).toContain('_platform.files.view');
  });

  test('L2 returns a level with empty permissions {}', async () => {
    const r = await clientLevelsHandler(
      new Request(`http://localhost/api/client-levels?client=${clientId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ level_number: 2, label: 'Manager' }),
      }), CTX,
    );
    expect(r.status).toBe(201);
    const body = await r.json() as { level: { permissions: Record<string, boolean> } };
    expect(body.level.permissions).toEqual({});
  });
});

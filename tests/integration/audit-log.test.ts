import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import auditLogHandler from '../../netlify/functions/audit-log';

const ADMIN_EMAIL = 'audit-log-test@example.com';
const ADMIN_PASSWORD = 'audit-log-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let cookie: string;
let adminId: string;
const inserted: number[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'Audit Log Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
    RETURNING id
  `) as { id: string }[];
  adminId = rows[0]!.id;
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

afterEach(async () => {
  if (inserted.length > 0) {
    await sql`DELETE FROM public.audit_log WHERE id = ANY(${inserted}::bigint[])`;
    inserted.length = 0;
  }
});

async function seedAudit(op: string, opts: Partial<{
  client_id: string; target_type: string; target_id: string;
  detail: Record<string, unknown>; actor_admin: string | null;
}> = {}) {
  const rows = (await sql`
    INSERT INTO public.audit_log (actor_admin, op, client_id, target_type, target_id, detail)
    VALUES (${opts.actor_admin === undefined ? adminId : opts.actor_admin},
            ${op},
            ${opts.client_id ?? null},
            ${opts.target_type ?? null},
            ${opts.target_id ?? null},
            ${opts.detail ? JSON.stringify(opts.detail) : null})
    RETURNING id
  `) as { id: number }[];
  inserted.push(rows[0]!.id);
  return rows[0]!.id;
}

async function call(query = '') {
  return auditLogHandler(
    new Request(`http://localhost/api/audit-log${query}`, { method: 'GET', headers: { cookie } }),
    CTX,
  );
}

describe('GET /api/audit-log', () => {
  test('non-admin (no cookie) returns 401', async () => {
    const r = await auditLogHandler(new Request('http://localhost/api/audit-log'), CTX);
    expect(r.status).toBe(401);
  });

  test('empty result set returns total=0 and empty entries array', async () => {
    // Filter narrow enough to exclude anything else in the dev DB.
    const r = await call('?op=zzz-no-such-op-xyz');
    expect(r.status).toBe(200);
    const body = await r.json() as { entries: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.entries).toEqual([]);
  });

  test('pagination: page_size + page work and total reflects filter', async () => {
    // Seed 3 rows with a unique op so other tests don't pollute the count.
    const uniqOp = `pagination.test.${Date.now()}`;
    await seedAudit(uniqOp);
    await seedAudit(uniqOp);
    await seedAudit(uniqOp);
    const r1 = await call(`?op=${encodeURIComponent(uniqOp)}&page_size=2&page=1`);
    const b1 = await r1.json() as { entries: unknown[]; total: number; page: number };
    expect(b1.total).toBe(3);
    expect(b1.entries.length).toBe(2);
    expect(b1.page).toBe(1);
    const r2 = await call(`?op=${encodeURIComponent(uniqOp)}&page_size=2&page=2`);
    const b2 = await r2.json() as { entries: unknown[]; total: number; page: number };
    expect(b2.entries.length).toBe(1);
    expect(b2.page).toBe(2);
  });

  test('filter by actor_admin', async () => {
    const uniqOp = `actor.test.${Date.now()}`;
    await seedAudit(uniqOp);
    // Should match because actor_admin == this test's admin.
    const r = await call(`?op=${encodeURIComponent(uniqOp)}&actor_admin=${adminId}`);
    const body = await r.json() as { total: number };
    expect(body.total).toBe(1);
    // Different admin id → no match.
    const r2 = await call(`?op=${encodeURIComponent(uniqOp)}&actor_admin=00000000-0000-0000-0000-000000000000`);
    const body2 = await r2.json() as { total: number };
    expect(body2.total).toBe(0);
  });

  test('filter by since/until date range', async () => {
    const uniqOp = `date.test.${Date.now()}`;
    const before = new Date(Date.now() - 60_000).toISOString();
    await seedAudit(uniqOp);
    const future = new Date(Date.now() + 60_000).toISOString();

    // Match: since=before, until=future → 1 row.
    const r1 = await call(`?op=${encodeURIComponent(uniqOp)}&since=${encodeURIComponent(before)}&until=${encodeURIComponent(future)}`);
    expect((await r1.json() as { total: number }).total).toBe(1);
    // No match: since=future → 0 rows.
    const r2 = await call(`?op=${encodeURIComponent(uniqOp)}&since=${encodeURIComponent(future)}`);
    expect((await r2.json() as { total: number }).total).toBe(0);
  });

  test('actor.label joined from admins table', async () => {
    const uniqOp = `label.test.${Date.now()}`;
    await seedAudit(uniqOp);
    const r = await call(`?op=${encodeURIComponent(uniqOp)}`);
    const body = await r.json() as { entries: Array<{ actor: { kind: string; id: string; label: string } }> };
    expect(body.entries[0]!.actor.kind).toBe('admin');
    expect(body.entries[0]!.actor.id).toBe(adminId);
    expect(body.entries[0]!.actor.label).toBe(ADMIN_EMAIL);
  });

  test('page_size clamped to 200 max', async () => {
    const r = await call('?page_size=99999');
    expect(r.status).toBe(200);
    const body = await r.json() as { page_size: number };
    expect(body.page_size).toBe(200);
  });

  test('default sort is occurred_at DESC', async () => {
    const uniqOp = `sort.test.${Date.now()}`;
    const id1 = await seedAudit(uniqOp);
    await new Promise((r) => setTimeout(r, 10));
    const id2 = await seedAudit(uniqOp);
    const r = await call(`?op=${encodeURIComponent(uniqOp)}`);
    const body = await r.json() as { entries: Array<{ id: number }> };
    expect(body.entries.length).toBe(2);
    expect(body.entries[0]!.id).toBe(id2);  // most recent first
    expect(body.entries[1]!.id).toBe(id1);
  });
});

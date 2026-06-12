import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import workspaceExportHandler from '../../netlify/functions/workspace-export';

const ADMIN_EMAIL = 'workspace-export-test@example.com';
const ADMIN_PASSWORD = 'workspace-export-pw';
const CTX = {} as Context;

let sql: ReturnType<typeof neon>;
let adminId: string;
let adminCookie: string;
let clientAId: string;

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);
  const h = await hashPassword(ADMIN_PASSWORD);
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${ADMIN_EMAIL}, ${h}, 'WE Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
    RETURNING id
  `) as { id: string }[];
  adminId = rows[0]!.id;

  // Seed a minimal client
  const clientRows = (await sql`
    INSERT INTO public.clients (slug, name, created_by)
    VALUES ('we-test-acme', 'WE Test Acme', ${adminId})
    ON CONFLICT (slug) DO UPDATE SET name = 'WE Test Acme'
    RETURNING id
  `) as { id: string }[];
  clientAId = clientRows[0]!.id;
});

beforeEach(async () => {
  await sql`DELETE FROM public.login_attempts WHERE email = ${ADMIN_EMAIL}`;
  const lr = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }), CTX,
  );
  adminCookie = lr.headers.get('set-cookie')!.split(';')[0]!;
});

afterEach(async () => {
  await sql`DELETE FROM public.audit_log WHERE op = 'workspace.exported' AND client_id = ${clientAId}::uuid`;
});

function buildReq(qs: string, opts: { cookie?: string; method?: string } = {}) {
  return new Request(`http://localhost/api/workspace-export${qs}`, {
    method: opts.method ?? 'GET',
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  });
}

import JSZipForTest from 'jszip';

describe('workspace-export — gates', () => {
  test('POST → 405', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie, method: 'POST' }),
      CTX,
    );
    expect(res.status).toBe(405);
  });

  test('missing format → 400 invalid_format', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('invalid_format');
  });

  test('format=foo → 400 invalid_format', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=foo&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
  });

  test('no cookie → 401', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`),
      CTX,
    );
    expect(res.status).toBe(401);
  });
});

describe('workspace-export — admin happy paths', () => {
  test('format=json returns 200 with workspace-<slug>-<iso>.json filename', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(res.headers.get('content-disposition')).toMatch(/filename="workspace-we-test-acme-\d{8}T\d{6}Z\.json"/);
    const body = await res.json();
    expect(body.schema_version).toBe(1);
    expect(body.client.id).toBe(clientAId);
  });

  test('format=json body never contains password_hash / temp_password_plain / password_reset_requested_at', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    const text = await res.text();
    expect(text).not.toMatch(/"password_hash"\s*:/);
    expect(text).not.toMatch(/"temp_password_plain"\s*:/);
    expect(text).not.toMatch(/"password_reset_requested_at"\s*:/);
  });

  test('format=zip returns 200 application/zip; manifest schema_version=1', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=zip&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/zip/);
    const buf = Buffer.from(await res.arrayBuffer());
    const z = await JSZipForTest.loadAsync(buf);
    const manifest = JSON.parse(await z.file('_manifest.json')!.async('string'));
    expect(manifest.schema_version).toBe(1);
    expect(manifest.client_id).toBe(clientAId);
  });

  test('admin without ?client= → 400 missing_client', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('missing_client');
  });
});

// ---------------------------------------------------------------------------
// Task 7 additions: cross-tenant safety, audit row, 413 path
// ---------------------------------------------------------------------------

// We seed a second client B with a uniquely-named user_node so the
// cross-tenant test has a needle to look for.
let clientBId: string;
let clientBNeedleNodeId: string;

beforeAll(async () => {
  const clientRows = (await sql`
    INSERT INTO public.clients (slug, name, created_by)
    VALUES ('we-test-bravo', 'WE Test Bravo', ${adminId})
    ON CONFLICT (slug) DO UPDATE SET name = 'WE Test Bravo'
    RETURNING id
  `) as { id: string }[];
  clientBId = clientRows[0]!.id;

  // Seed one role + L1 for clientB so the user_node FK is satisfied.
  // client_roles uses `label` (not `name`) and requires `color` (NOT NULL).
  // There is no `created_by_admin` column on client_roles or client_levels.
  const roleRows = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientBId}, 'owner', 'Owner', '#3b82f6')
    ON CONFLICT (client_id, key) DO UPDATE SET label = 'Owner'
    RETURNING id
  `) as { id: string }[];
  const roleBId = roleRows[0]!.id;

  // client_levels uses `label` (nullable); no `created_by_admin` column.
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label)
    VALUES (${clientBId}, 1, 'Primary')
    ON CONFLICT (client_id, level_number) DO NOTHING
  `;

  // user_nodes does have `created_by_admin` (uuid NOT NULL REFERENCES admins).
  const nodeRows = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientBId}, NULL, 1, ${roleBId}, 'CLIENT_B_NEEDLE_HUMAN', 'needle@b.test', ${adminId})
    RETURNING id
  `) as { id: string }[];
  clientBNeedleNodeId = nodeRows[0]!.id;
});

afterAll(async () => {
  await sql`DELETE FROM public.user_nodes WHERE client_id = ${clientBId}::uuid`;
  await sql`DELETE FROM public.client_levels WHERE client_id = ${clientBId}::uuid`;
  await sql`DELETE FROM public.client_roles WHERE client_id = ${clientBId}::uuid`;
  await sql`DELETE FROM public.clients WHERE id = ${clientBId}::uuid`;
});

describe('workspace-export — cross-tenant safety (highest-value test)', () => {
  test('exporting client A does NOT include client B rows', async () => {
    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('CLIENT_B_NEEDLE_HUMAN');
    expect(text).not.toContain(clientBNeedleNodeId);
    expect(text).not.toContain('needle@b.test');
  });
});

describe('workspace-export — audit row', () => {
  test('exactly one workspace.exported row written per successful export', async () => {
    // Pre-clear any stale rows (afterEach cleans up too, but belt-and-suspenders).
    await sql`DELETE FROM public.audit_log WHERE op = 'workspace.exported' AND client_id = ${clientAId}::uuid`;

    const res = await workspaceExportHandler(
      buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
      CTX,
    );
    expect(res.status).toBe(200);

    const rows = (await sql`
      SELECT actor_admin, actor_user_node, target_type, target_id, detail
      FROM public.audit_log
      WHERE op = 'workspace.exported' AND client_id = ${clientAId}::uuid
      ORDER BY occurred_at DESC LIMIT 5
    `) as Array<{
      actor_admin: string | null;
      actor_user_node: string | null;
      target_type: string;
      target_id: string;
      detail: Record<string, unknown>;
    }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.actor_admin).toBe(adminId);
    expect(rows[0]!.actor_user_node).toBeNull();
    expect(rows[0]!.target_type).toBe('workspace');
    expect(rows[0]!.target_id).toBe(clientAId);
    const d = rows[0]!.detail as { format: string; table_counts: Record<string, number> };
    expect(d.format).toBe('json');
    expect(typeof d.table_counts.user_nodes).toBe('number');
  });
});

describe('workspace-export — 413 path (env-var override)', () => {
  test('ExportTooLargeError mapped to 413 with size_bytes + limit_bytes', async () => {
    // Set MAX_BYTES cap to 1 byte so any real response exceeds it.
    // workspace-export-format.ts reads process.env.WORKSPACE_EXPORT_MAX_BYTES
    // and uses that value when present.
    const original = process.env.WORKSPACE_EXPORT_MAX_BYTES;
    process.env.WORKSPACE_EXPORT_MAX_BYTES = '1';
    try {
      const res = await workspaceExportHandler(
        buildReq(`?format=json&client=${clientAId}`, { cookie: adminCookie }),
        CTX,
      );
      expect(res.status).toBe(413);
      const body = await res.json() as { error?: { code?: string; details?: { size_bytes?: number; limit_bytes?: number } } };
      expect(body.error?.code).toBe('export_too_large');
      expect(typeof body.error?.details?.size_bytes).toBe('number');
      expect((body.error?.details?.size_bytes ?? 0) > 1).toBe(true);
      expect(body.error?.details?.limit_bytes).toBe(1);
    } finally {
      if (original === undefined) {
        delete process.env.WORKSPACE_EXPORT_MAX_BYTES;
      } else {
        process.env.WORKSPACE_EXPORT_MAX_BYTES = original;
      }
    }
  });
});

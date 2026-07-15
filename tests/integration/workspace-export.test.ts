import type { Context } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import loginHandler from '../../netlify/functions/auth-login';
import uLoginHandler from '../../netlify/functions/u-login';
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
    ON CONFLICT (client_id, (lower(email::text))) WHERE email IS NOT NULL
      DO UPDATE SET display_name = EXCLUDED.display_name
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

// ---------------------------------------------------------------------------
// Task 8: Bucket-user permission boundary
// ---------------------------------------------------------------------------
//
// Schema notes (carried from Tasks 5-7):
//   client_roles  — columns: id, client_id, key, label, color (NOT NULL), fields, sort_order
//                   NO `name`, NO `created_by_admin`
//   client_levels — columns: id, client_id, level_number, label, permissions (jsonb, default '{}')
//                   NO `created_by_admin`, NO `name`
//   user_nodes    — created_by_admin is nullable (migration 023); pass adminId
//   bu_session    — cookie name used by u-login / mintBucketUserSession

async function seedBucketUserForClientA(opts: { levelNumber: number; permKey?: string }): Promise<{
  nodeId: string;
  email: string;
  password: string;
}> {
  // Seed role — label (not name), color required, NO created_by_admin.
  const roleKey = `role-l${opts.levelNumber}`;
  const roleRows = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientAId}, ${roleKey}, ${'Role L' + opts.levelNumber}, '#64748b')
    ON CONFLICT (client_id, key) DO UPDATE SET label = ${'Role L' + opts.levelNumber}
    RETURNING id
  `) as { id: string }[];
  const roleId = roleRows[0]!.id;

  // Seed level — label nullable, permissions jsonb, NO created_by_admin.
  const perms: Record<string, true> = opts.permKey ? { [opts.permKey]: true } : {};
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, permissions)
    VALUES (${clientAId}, ${opts.levelNumber}, ${'Level ' + opts.levelNumber}, ${JSON.stringify(perms)}::jsonb)
    ON CONFLICT (client_id, level_number) DO UPDATE SET permissions = ${JSON.stringify(perms)}::jsonb
  `;

  // For L2+ we need a parent at level_number - 1. Build the chain L1 → L2 → ... → target.
  let parentId: string | null = null;
  if (opts.levelNumber > 1) {
    // Ensure L1 exists.
    const l1RoleRows = (await sql`
      INSERT INTO public.client_roles (client_id, key, label, color)
      VALUES (${clientAId}, 'owner', 'Owner', '#3b82f6')
      ON CONFLICT (client_id, key) DO UPDATE SET label = 'Owner'
      RETURNING id
    `) as { id: string }[];
    await sql`
      INSERT INTO public.client_levels (client_id, level_number, label, permissions)
      VALUES (${clientAId}, 1, 'Primary', '{}'::jsonb)
      ON CONFLICT (client_id, level_number) DO NOTHING
    `;
    const l1Email = `seed-l1@we-test.example`;
    await sql`
      INSERT INTO public.user_nodes
        (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
      VALUES (${clientAId}, NULL, 1, ${l1RoleRows[0]!.id}, 'L1 Owner Seed', ${l1Email}, ${adminId})
      ON CONFLICT (client_id, (lower(email::text))) WHERE email IS NOT NULL
        DO UPDATE SET display_name = 'L1 Owner Seed'
    `;
    const l1NodeRows = (await sql`
      SELECT id FROM public.user_nodes
      WHERE client_id = ${clientAId}::uuid AND lower(email::text) = lower(${l1Email})
      LIMIT 1
    `) as { id: string }[];
    let currentParentId = l1NodeRows[0]!.id;

    // Build intermediate levels if needed (L2, L3, ..., levelNumber - 1).
    for (let lvl = 2; lvl < opts.levelNumber; lvl++) {
      const intRoleKey = `role-l${lvl}`;
      const intRoleRows = (await sql`
        INSERT INTO public.client_roles (client_id, key, label, color)
        VALUES (${clientAId}, ${intRoleKey}, ${'Role L' + lvl}, '#94a3b8')
        ON CONFLICT (client_id, key) DO UPDATE SET label = ${'Role L' + lvl}
        RETURNING id
      `) as { id: string }[];
      await sql`
        INSERT INTO public.client_levels (client_id, level_number, label, permissions)
        VALUES (${clientAId}, ${lvl}, ${'Level ' + lvl}, '{}'::jsonb)
        ON CONFLICT (client_id, level_number) DO NOTHING
      `;
      const intEmail = `seed-l${lvl}@we-test.example`;
      await sql`
        INSERT INTO public.user_nodes
          (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
        VALUES (${clientAId}, ${currentParentId}, ${lvl}, ${intRoleRows[0]!.id},
                ${'L' + lvl + ' Intermediate Seed'}, ${intEmail}, ${adminId})
        ON CONFLICT (client_id, (lower(email::text))) WHERE email IS NOT NULL
          DO UPDATE SET display_name = ${'L' + lvl + ' Intermediate Seed'}
      `;
      const intNodeRows = (await sql`
        SELECT id FROM public.user_nodes
        WHERE client_id = ${clientAId}::uuid AND lower(email::text) = lower(${intEmail})
        LIMIT 1
      `) as { id: string }[];
      currentParentId = intNodeRows[0]!.id;
    }

    parentId = currentParentId;
  }

  // Use level_number in email to avoid collision between L1 and L2 tests
  // when both run in the same suite run.
  const email = `bu-l${opts.levelNumber}-${opts.permKey ? 'perm' : 'noperm'}@we-test.example`;

  // The unique index on user_nodes.email is a partial index:
  //   UNIQUE (client_id, lower(email::text)) WHERE email IS NOT NULL
  // PostgreSQL requires ON CONFLICT to name the exact index columns + WHERE
  // clause. We use DO NOTHING + a follow-up SELECT to stay idempotent.
  await sql`
    INSERT INTO public.user_nodes
      (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientAId}, ${parentId}, ${opts.levelNumber}, ${roleId},
            ${'BU L' + opts.levelNumber + (opts.permKey ? ' (perm)' : '')},
            ${email}, ${adminId})
    ON CONFLICT (client_id, (lower(email::text))) WHERE email IS NOT NULL
      DO UPDATE SET display_name = ${'BU L' + opts.levelNumber + (opts.permKey ? ' (perm)' : '')}
  `;
  const nodeRows = (await sql`
    SELECT id FROM public.user_nodes
    WHERE client_id = ${clientAId}::uuid AND lower(email::text) = lower(${email})
    LIMIT 1
  `) as { id: string }[];
  const nodeId = nodeRows[0]!.id;

  const password = `bu-pw-L${opts.levelNumber}${opts.permKey ? '-p' : ''}`;
  const hash = await hashPassword(password);
  await sql`
    INSERT INTO public.user_node_credentials
      (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
    VALUES (${clientAId}, ${nodeId}, ${email}, ${hash}, false, ${adminId})
    ON CONFLICT (user_node_id)
      DO UPDATE SET password_hash = ${hash}, must_change_password = false, email = ${email}
  `;

  return { nodeId, email, password };
}

async function loginBucketUser(email: string, password: string, slug: string): Promise<string> {
  // Clear rate-limit rows so repeated test runs don't lock the account.
  await sql`DELETE FROM public.login_attempts WHERE email = ${email}`;

  const r = await uLoginHandler(
    new Request(`http://localhost/api/u-login?client=${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    CTX,
  );
  if (r.status !== 200) {
    throw new Error(`bucket-user login failed (${r.status}): ${await r.text()}`);
  }
  // Cookie header format: "bu_session=<token>; HttpOnly; ..."
  // split(';')[0] gives "bu_session=<token>" which browsers / our readNamedCookie accept.
  return r.headers.get('set-cookie')!.split(';')[0]!;
}

describe('workspace-export — bucket-user permission boundary', () => {
  // Bucket-users are JWT-scoped; no ?client= needed. resolveClientId derives it from the token.

  test('L1 Owner without explicit perm → 200 (matrix bypass)', async () => {
    const u = await seedBucketUserForClientA({ levelNumber: 1 });
    const cookie = await loginBucketUser(u.email, u.password, 'we-test-acme');
    const res = await workspaceExportHandler(
      buildReq('?format=json', { cookie }),
      CTX,
    );
    expect(res.status).toBe(200);
  });

  test('L2 without perm → 403', async () => {
    const u = await seedBucketUserForClientA({ levelNumber: 2 });
    const cookie = await loginBucketUser(u.email, u.password, 'we-test-acme');
    const res = await workspaceExportHandler(
      buildReq('?format=json', { cookie }),
      CTX,
    );
    expect(res.status).toBe(403);
  });

  test('L2 with _platform.workspace.view granted → 200', async () => {
    // Use level_number 3 (not 2) so this test doesn't share a row in
    // client_levels with the L2-no-perm test above. Both share clientA;
    // the ON CONFLICT (client_id, level_number) DO UPDATE on the level's
    // permissions would otherwise leak state between tests if they ever
    // ran concurrently.
    const u = await seedBucketUserForClientA({
      levelNumber: 3,
      permKey: '_platform.workspace.view',
    });
    const cookie = await loginBucketUser(u.email, u.password, 'we-test-acme');
    const res = await workspaceExportHandler(
      buildReq('?format=json', { cookie }),
      CTX,
    );
    expect(res.status).toBe(200);
  });
});

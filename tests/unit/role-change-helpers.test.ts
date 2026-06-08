// tests/unit/role-change-helpers.test.ts
//
// Unit-scope tests for the validators shared between user-nodes-role-change
// and user-nodes-bulk-role-change. Real Neon dev DB; each test isolates via
// a per-suite fixture client.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import { validateLevelAllowsRole, validateCardinality } from '../../netlify/functions/_shared/role-change';

let sql: NeonQueryFunction<false, false>;
let clientId: string;
let roleA: string;
let roleB: string;
let roleParent: string;
const createdClients: string[] = [];
const createdAdmins: string[] = [];

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!) as NeonQueryFunction<false, false>;
  // Create a minimal admin to own the test client
  const adminEmail = `role-change-test-${Date.now()}@example.com`;
  const h = await hashPassword('test-password');
  const admin = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES (${adminEmail}, ${h}, 'Role Change Test', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${h}
    RETURNING id
  `) as { id: string }[];
  const adminId = admin[0]!.id;
  createdAdmins.push(adminId);

  // Minimal fixture: one client, three roles, one level with [roleA] allowed,
  // one cardinality rule capping roleA under roleParent at 2.
  const slug = `rch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const c = (await sql`
    INSERT INTO public.clients (name, slug, created_by)
    VALUES (${'role-change-helpers-' + Date.now()}, ${slug}, ${adminId}::uuid)
    RETURNING id
  `) as { id: string }[];
  clientId = c[0]!.id;
  createdClients.push(clientId);
  const rp = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}::uuid, 'parent', 'Parent', '#000') RETURNING id
  `) as { id: string }[];
  roleParent = rp[0]!.id;
  const ra = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}::uuid, 'roleA', 'A', '#111') RETURNING id
  `) as { id: string }[];
  roleA = ra[0]!.id;
  const rb = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}::uuid, 'roleB', 'B', '#222') RETURNING id
  `) as { id: string }[];
  roleB = rb[0]!.id;
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
    VALUES (${clientId}::uuid, 2, 'L2', ARRAY[${roleA}::uuid])
  `;
  await sql`
    INSERT INTO public.client_cardinality_rules (client_id, parent_role_id, child_role_id, max_children)
    VALUES (${clientId}::uuid, ${roleParent}::uuid, ${roleA}::uuid, 2)
  `;
});

afterAll(async () => {
  for (const id of createdClients) {
    try { await sql`DELETE FROM public.clients WHERE id = ${id}::uuid`; } catch { /* */ }
  }
  for (const id of createdAdmins) {
    try { await sql`DELETE FROM public.admins WHERE id = ${id}::uuid`; } catch { /* */ }
  }
});

describe('validateLevelAllowsRole', () => {
  test('returns ok when role is in allowed_role_ids', async () => {
    const r = await validateLevelAllowsRole(sql, clientId, 2, roleA);
    expect(r.ok).toBe(true);
  });

  test('returns level_disallows_role when role is not in allowed_role_ids', async () => {
    const r = await validateLevelAllowsRole(sql, clientId, 2, roleB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('level_disallows_role');
  });

  test('returns level_disallows_role when level does not exist', async () => {
    const r = await validateLevelAllowsRole(sql, clientId, 99, roleA);
    expect(r.ok).toBe(false);
  });
});

describe('validateCardinality', () => {
  test('returns ok when no cardinality rule exists for the (parent_role, new_role) pair', async () => {
    // No rule for (roleParent → roleB). Capless ⇒ ok.
    const parent = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleParent}::uuid, 1, NULL, 'parent', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const parentId = parent[0]!.id;
    const r = await validateCardinality(sql, clientId, parentId, roleB, roleA);
    expect(r.ok).toBe(true);
    await sql`DELETE FROM public.user_nodes WHERE id = ${parentId}::uuid`;
  });

  test('returns ok when projected count is at or below the cap', async () => {
    const parent = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleParent}::uuid, 1, NULL, 'parent', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const parentId = parent[0]!.id;
    // One existing roleA child; new arrival would make 2 (cap is 2).
    await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'child1', '{}'::jsonb)
    `;
    // Target is currently roleB under parentId — projected post-change = 1 + 1 = 2.
    const r = await validateCardinality(sql, clientId, parentId, roleA, roleB);
    expect(r.ok).toBe(true);
    await sql`DELETE FROM public.user_nodes WHERE parent_id = ${parentId}::uuid OR id = ${parentId}::uuid`;
  });

  test('returns cardinality_exceeded with max when projected count exceeds cap', async () => {
    const parent = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleParent}::uuid, 1, NULL, 'parent', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const parentId = parent[0]!.id;
    // Two existing roleA children; a third would exceed.
    await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'c1', '{}'::jsonb),
             (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'c2', '{}'::jsonb)
    `;
    const r = await validateCardinality(sql, clientId, parentId, roleA, roleB);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe('cardinality_exceeded'); expect(r.max).toBe(2); }
    await sql`DELETE FROM public.user_nodes WHERE parent_id = ${parentId}::uuid OR id = ${parentId}::uuid`;
  });

  test('does NOT double-count a target already in the new-role cohort under same parent', async () => {
    const parent = (await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleParent}::uuid, 1, NULL, 'parent', '{}'::jsonb)
      RETURNING id
    `) as { id: string }[];
    const parentId = parent[0]!.id;
    // Two existing roleA children; one of them IS the target (currentRoleId = roleA).
    // Projected = 2 - 1 + 1 = 2 ≤ cap 2 → ok.
    await sql`
      INSERT INTO public.user_nodes (client_id, role_id, level_number, parent_id, display_name, fields)
      VALUES (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'c1', '{}'::jsonb),
             (${clientId}::uuid, ${roleA}::uuid, 2, ${parentId}::uuid, 'c2', '{}'::jsonb)
    `;
    const r = await validateCardinality(sql, clientId, parentId, roleA, roleA);
    expect(r.ok).toBe(true);
    await sql`DELETE FROM public.user_nodes WHERE parent_id = ${parentId}::uuid OR id = ${parentId}::uuid`;
  });
});

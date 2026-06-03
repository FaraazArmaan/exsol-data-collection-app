// netlify/functions/onboard-client.ts
//
// POST /api/onboard-client — admin-only.
// Single-transaction onboarding: creates client + enabled products + roles
// + levels + cardinality + L1 Owner node + Owner credential, all-or-nothing.
//
// Roles/levels/cardinality reference each other by key/level_number; UUIDs
// don't exist until the transaction creates the rows.
//
// On any failure (validation, FK, cardinality), the Postgres transaction
// rolls back and the response body identifies the failing section.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { deriveSlug } from './_shared/identifier';
import { hashPassword } from './_shared/argon';

const RoleSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]*$/).max(50),
  label: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bucket_family: z.enum(['business', 'employees', 'customers', 'products']).nullable().optional(),
});

const LevelSchema = z.object({
  level_number: z.number().int().min(1),
  label: z.string().max(100).nullable().optional(),
  allowed_role_keys: z.array(z.string()),
});

const CardinalitySchema = z.object({
  parent_role_key: z.string().nullable(),
  child_role_key: z.string(),
  max_children: z.number().int().min(0),
});

const OwnerSchema = z.object({
  display_name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  temp_password: z.string().min(8).max(200),
});

const Body = z.object({
  name: z.string().min(1).max(200),
  enabled_products: z.array(z.string()),
  roles: z.array(RoleSchema),
  levels: z.array(LevelSchema),
  cardinality_rules: z.array(CardinalitySchema),
  owner: OwnerSchema,
});

type Section = 'name' | 'products' | 'roles' | 'levels' | 'cardinality' | 'owner';
function err(status: number, code: string, section: Section, extra?: Record<string, unknown>) {
  return jsonError(status, code, { section, ...(extra ?? {}) });
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const data = parsed.data;
  const adminId = actor.admin.id;

  // ---- AUTO-SEED roles + levels if empty (spec §4.4) ----
  let roles = data.roles;
  let levels = data.levels;
  if (roles.length === 0) {
    roles = [{ key: 'owner', label: 'Owner', color: '#3b82f6' }];
  }
  if (levels.length === 0) {
    // Use the first role's key as the L1 allowed role.
    levels = [{ level_number: 1, label: 'Primary', allowed_role_keys: [roles[0]!.key] }];
  }

  // ---- VALIDATE references (pre-transaction; cheap fail-fast) ----
  const roleKeys = new Set(roles.map((r) => r.key));
  for (const lv of levels) {
    for (const k of lv.allowed_role_keys) {
      if (!roleKeys.has(k)) {
        return err(400, 'invalid_reference', 'levels', { unknown_role_key: k, level_number: lv.level_number });
      }
    }
  }
  for (const rule of data.cardinality_rules) {
    if (rule.parent_role_key !== null && !roleKeys.has(rule.parent_role_key)) {
      return err(400, 'invalid_reference', 'cardinality', { unknown_role_key: rule.parent_role_key });
    }
    if (!roleKeys.has(rule.child_role_key)) {
      return err(400, 'invalid_reference', 'cardinality', { unknown_role_key: rule.child_role_key });
    }
  }

  // ---- Determine Owner's role (spec §4.5) ----
  const level1 = levels.find((l) => l.level_number === 1);
  if (!level1 || level1.allowed_role_keys.length === 0) {
    return err(400, 'level_1_has_no_roles', 'levels');
  }
  const ownerRoleKey = roles.find((r) => level1.allowed_role_keys.includes(r.key))?.key;
  if (!ownerRoleKey) {
    return err(400, 'level_1_has_no_roles', 'levels');
  }

  // ---- Cardinality pre-check: if seeding 1 Owner would violate a top-level cap on the Owner's role, fail (spec §5) ----
  for (const rule of data.cardinality_rules) {
    if (rule.parent_role_key === null && rule.child_role_key === ownerRoleKey && rule.max_children < 1) {
      return err(409, 'cardinality_violation', 'owner', {
        rule: { parent_role_key: null, child_role_key: ownerRoleKey, max_children: rule.max_children },
      });
    }
  }

  // ---- Slug derivation with collision handling (mirrors clients.ts pattern) ----
  const sql = db();
  const baseSlug = deriveSlug(data.name);
  let slug = baseSlug;
  let suffix = 2;
  for (let i = 0; i < 25; i++) {
    const existing = (await sql`SELECT 1 FROM public.clients WHERE slug = ${slug} LIMIT 1`) as unknown[];
    if (existing.length === 0) break;
    slug = `${baseSlug}-${suffix++}`;
    if (i === 24) return err(422, 'slug_collision', 'name');
  }

  // ---- Hash the Owner password OUTSIDE the txn (argon2 is slow; don't hold the connection) ----
  const ownerPwHash = await hashPassword(data.owner.temp_password);

  // ---- THE TRANSACTION ----
  // Pre-generated UUIDs approach: we generate clientId, ownerNodeId, and
  // Map<roleKey, roleId> upfront so every INSERT in one sql.transaction([...])
  // call can use them as literals. On any error, the whole txn rolls back.

  const clientId = crypto.randomUUID();
  const ownerNodeId = crypto.randomUUID();
  const roleIdByKey = new Map<string, string>();
  for (const r of roles) roleIdByKey.set(r.key, crypto.randomUUID());

  const queries: unknown[] = [];

  // 1. client
  queries.push(sql`
    INSERT INTO public.clients (id, name, slug, created_by)
    VALUES (${clientId}::uuid, ${data.name}, ${slug}, ${adminId}::uuid)
  `);

  // 2. enabled products
  for (const pk of data.enabled_products) {
    queries.push(sql`
      INSERT INTO public.client_enabled_products (client_id, product_key)
      VALUES (${clientId}::uuid, ${pk})
    `);
  }

  // 3. roles
  for (const r of roles) {
    queries.push(sql`
      INSERT INTO public.client_roles (id, client_id, key, label, color, bucket_family)
      VALUES (${roleIdByKey.get(r.key)!}::uuid, ${clientId}::uuid, ${r.key}, ${r.label}, ${r.color},
              ${r.bucket_family ?? null})
    `);
  }

  // 4. levels
  for (const lv of levels) {
    const allowedIds = lv.allowed_role_keys.map((k) => roleIdByKey.get(k)!);
    queries.push(sql`
      INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
      VALUES (${clientId}::uuid, ${lv.level_number}, ${lv.label ?? null},
              ${allowedIds}::uuid[])
    `);
  }

  // 5. cardinality
  for (const rule of data.cardinality_rules) {
    const parentId = rule.parent_role_key === null ? null : roleIdByKey.get(rule.parent_role_key)!;
    const childId = roleIdByKey.get(rule.child_role_key)!;
    queries.push(sql`
      INSERT INTO public.client_cardinality_rules (client_id, parent_role_id, child_role_id, max_children)
      VALUES (${clientId}::uuid, ${parentId}::uuid, ${childId}::uuid, ${rule.max_children})
    `);
  }

  // 6. Owner user_node
  const ownerRoleId = roleIdByKey.get(ownerRoleKey)!;
  queries.push(sql`
    INSERT INTO public.user_nodes (
      id, client_id, parent_id, level_number, role_id,
      display_name, email, phone, notes, fields, created_by_admin
    )
    VALUES (
      ${ownerNodeId}::uuid, ${clientId}::uuid, NULL, 1, ${ownerRoleId}::uuid,
      ${data.owner.display_name},
      ${data.owner.email},
      ${data.owner.phone ?? null},
      ${data.owner.notes ?? null},
      '{}'::jsonb,
      ${adminId}::uuid
    )
  `);

  // 7. Owner credential
  queries.push(sql`
    INSERT INTO public.user_node_credentials (
      client_id, user_node_id, email, password_hash, must_change_password,
      temp_password_plain, temp_password_views_left, created_by_admin
    )
    VALUES (
      ${clientId}::uuid, ${ownerNodeId}::uuid, ${data.owner.email},
      ${ownerPwHash}, true, ${data.owner.temp_password}, 3, ${adminId}::uuid
    )
  `);

  // Execute the transaction.
  try {
    await sql.transaction(queries as never);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    const msg = (e as Error)?.message ?? '';
    // Postgres SQLSTATE codes:
    //   23505 — unique_violation (slug or email collision)
    //   23503 — foreign_key_violation (shouldn't happen post-validation)
    //   23514 — check_violation (e.g., level/parent consistency check)
    if (code === '23505') {
      if (msg.includes('user_node_credentials')) {
        return err(409, 'email_already_has_login_in_this_workspace', 'owner');
      }
      if (msg.includes('clients_slug_key') || msg.includes('clients_slug')) {
        return err(422, 'slug_collision', 'name');
      }
      return err(409, 'duplicate_row', 'roles', { sqlstate: code });
    }
    if (code === '23503') {
      return err(400, 'foreign_key_violation', 'levels', { sqlstate: code });
    }
    if (code === '23514') {
      return err(400, 'check_violation', 'levels', { sqlstate: code });
    }
    throw e; // unknown — let it 500
  }

  return jsonOk({
    client: { id: clientId, name: data.name, slug },
  }, { status: 201 });
};

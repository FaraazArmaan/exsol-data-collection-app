// netlify/functions/onboard-client-bulk.ts
//
// POST /api/onboard-client-bulk — admin-only.
// Single-transaction onboarding: client + roles + levels + cardinality
// + every team_member user_node + every credential, all-or-nothing.
//
// Reference implementations:
//   - onboard-client.ts (pre-UUID + sql.transaction template)
//   - user-nodes-bulk.ts (cross-row parent_email + per-parent cardinality)
//
// 1-role-per-level model: role row order in the import IS the level number.
// Level N's allowed_role_ids = [role at row N]. Cardinality rule for row N
// is (parent_role = role at row N-1, child_role = role at row N, max_children
// = row N's Max per parent). Row 1's cardinality rule (if any) is parent=null.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { deriveSlug } from './_shared/identifier';
import { hashPassword } from './_shared/argon';
import { logAudit } from './_shared/audit';
import { getProduct } from '../../src/modules/registry/products';

// ----- Validation (Zod) -----

const RoleSchema = z.object({
  label: z.string().min(1).max(100),
  max_per_parent: z.number().int().positive().nullable(),
});

const TeamSchema = z.object({
  display_name: z.string().min(1).max(200),
  role_label: z.string().min(1).max(100),
  parent_email: z.string().email().nullable(),
  email: z.string().email(),
  phone: z.string().max(50).nullable(),
  notes: z.string().max(2000).nullable(),
  temp_password: z.string().min(8).max(200).nullable(),
});

const Body = z.object({
  workspace: z.object({
    name: z.string().min(1).max(200),
    enabled_products: z.array(z.string()),
  }),
  roles: z.array(RoleSchema),
  team: z.array(TeamSchema),
});

// ----- Helpers -----

interface RowError { section: 'workspace' | 'roles' | 'team'; row_index: number; errors: string[] }

const COLOR_PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#f97316'];

function colorForRoleIndex(i: number): string {
  return COLOR_PALETTE[i % COLOR_PALETTE.length]!;
}

function genTempPassword(): string {
  // Mirrors src/lib/random-password.ts (vowel-light, 12 char). Duplicated
  // because the function bundle can't reliably resolve src/ imports.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 12; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
  const adminId = actor.admin.id;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const data = parsed.data;

  if (data.roles.length > 20) return jsonError(400, 'too_many_roles');
  if (data.team.length > 500) return jsonError(400, 'too_many_rows');
  if (data.team.length === 0 || data.roles.length === 0) return jsonError(400, 'empty_payload');

  // ---- VALIDATION PASS (no DB writes) ----
  const errors: RowError[] = [];

  // Workspace
  for (const key of data.workspace.enabled_products) {
    if (!getProduct(key)) return jsonError(400, 'unknown_product_key', { key });
  }

  // Roles — slug uniqueness
  const roleKeyByLabel = new Map<string, string>();
  const slugSeen = new Map<string, number>();   // slug → first row index
  for (let i = 0; i < data.roles.length; i++) {
    const r = data.roles[i]!;
    const key = deriveSlug(r.label);
    if (slugSeen.has(key)) {
      return jsonError(400, 'duplicate_role_slug', { key, rows: [slugSeen.get(key)!, i] });
    }
    slugSeen.set(key, i);
    roleKeyByLabel.set(r.label, key);
  }

  // Team — index by email, then validate.
  // role_label → role row index gives us the level number (row_idx + 1).
  const roleIdxByLabel = new Map<string, number>();
  for (let i = 0; i < data.roles.length; i++) roleIdxByLabel.set(data.roles[i]!.label, i);

  const teamByEmail = new Map<string, number>();
  for (let i = 0; i < data.team.length; i++) {
    const t = data.team[i]!;
    if (teamByEmail.has(t.email.toLowerCase())) {
      errors.push({ section: 'team', row_index: i, errors: [`duplicate email "${t.email}"`] });
    }
    teamByEmail.set(t.email.toLowerCase(), i);
  }

  // Track per-parent counts for cardinality (key: parentRowIdx|'root' + ':' + childRoleIdx → count)
  const counts = new Map<string, number>();

  for (let i = 0; i < data.team.length; i++) {
    const t = data.team[i]!;
    const rowErrors: string[] = [];

    const roleIdx = roleIdxByLabel.get(t.role_label);
    if (roleIdx === undefined) {
      rowErrors.push(`unknown role "${t.role_label}"`);
    }

    let parentRowIdx: number | null = null;
    if (t.parent_email) {
      const idx = teamByEmail.get(t.parent_email.toLowerCase());
      if (idx === undefined) {
        rowErrors.push(`parent_email "${t.parent_email}" not found in Team sheet`);
      } else if (idx === i) {
        rowErrors.push('parent_email refers to this row');
      } else {
        parentRowIdx = idx;
      }
    }

    // Level → role consistency: a row claiming parent_email AND a role that's
    // at level 1 is wrong. A row with no parent_email AND a role NOT at level 1
    // is also wrong (no implicit parent attachment in this version).
    if (roleIdx !== undefined && rowErrors.length === 0) {
      if (roleIdx === 0 && parentRowIdx !== null) {
        rowErrors.push(`role "${t.role_label}" is Level 1 — must have empty parent_email`);
      } else if (roleIdx > 0 && parentRowIdx === null) {
        rowErrors.push(`role "${t.role_label}" requires a parent_email`);
      } else if (roleIdx > 0 && parentRowIdx !== null) {
        const parent = data.team[parentRowIdx]!;
        const parentRoleIdx = roleIdxByLabel.get(parent.role_label);
        if (parentRoleIdx === undefined || parentRoleIdx !== roleIdx - 1) {
          rowErrors.push(`parent must be at level ${roleIdx} (a "${data.roles[roleIdx - 1]!.label}")`);
        }
      }
    }

    // Cardinality check.
    if (rowErrors.length === 0 && roleIdx !== undefined) {
      const cap = data.roles[roleIdx]!.max_per_parent;
      if (cap !== null) {
        const key = `${parentRowIdx ?? 'root'}:${roleIdx}`;
        const current = counts.get(key) ?? 0;
        if (current + 1 > cap) {
          const parentName = parentRowIdx === null ? 'workspace root' : data.team[parentRowIdx]!.display_name;
          rowErrors.push(`max ${cap} ${t.role_label}(s) per ${parentName} — would be ${current + 1}`);
        } else {
          counts.set(key, current + 1);
        }
      }
    }

    if (rowErrors.length > 0) errors.push({ section: 'team', row_index: i, errors: rowErrors });
  }

  // L1 owner check. If any row has an unresolvable role label, the user may
  // have typo'd what was meant to be the L1 owner — surface the aggregated
  // row errors first so they can fix the typo. Otherwise the missing L1 owner
  // takes precedence over downstream row issues (e.g., a Level-2 row stranded
  // without a parent because no Level-1 owner was provided).
  const anyUnknownRole = data.team.some((t) => !roleIdxByLabel.has(t.role_label));
  const l1RoleLabel = data.roles[0]!.label;
  const l1Count = data.team.filter((t) => t.role_label === l1RoleLabel).length;
  if (!anyUnknownRole) {
    if (l1Count === 0) return jsonError(400, 'no_l1_owner');
    const l1Cap = data.roles[0]!.max_per_parent;
    if (l1Cap !== null && l1Count > l1Cap) return jsonError(400, 'too_many_l1_owners', { max: l1Cap, count: l1Count });
  }

  if (errors.length > 0) return jsonError(400, 'bulk_validation_failed', { errors });

  // ---- SLUG with collision retry (mirror onboard-client.ts:127-135) ----
  const sql = db();
  const baseSlug = deriveSlug(data.workspace.name);
  let slug = baseSlug;
  let suffix = 2;
  for (let i = 0; i < 25; i++) {
    const existing = (await sql`SELECT 1 FROM public.clients WHERE slug = ${slug} LIMIT 1`) as unknown[];
    if (existing.length === 0) break;
    slug = `${baseSlug}-${suffix++}`;
    if (i === 24) return jsonError(422, 'slug_collision');
  }

  // ---- Auto-gen passwords + hash OUTSIDE txn ----
  const finalPasswords = data.team.map((t) => t.temp_password ?? genTempPassword());
  const passwordHashes = await Promise.all(finalPasswords.map((p) => hashPassword(p)));

  // ---- Pre-generate UUIDs ----
  const clientId = crypto.randomUUID();
  const roleIds = data.roles.map(() => crypto.randomUUID());
  const teamIds = data.team.map(() => crypto.randomUUID());

  // ---- Build the txn ----
  const queries: unknown[] = [];

  queries.push(sql`
    INSERT INTO public.clients (id, name, slug, created_by)
    VALUES (${clientId}::uuid, ${data.workspace.name}, ${slug}, ${adminId}::uuid)
  `);
  for (const pk of data.workspace.enabled_products) {
    queries.push(sql`
      INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
      VALUES (${clientId}::uuid, ${pk}, ${adminId}::uuid)
    `);
  }
  for (let i = 0; i < data.roles.length; i++) {
    const r = data.roles[i]!;
    const key = roleKeyByLabel.get(r.label)!;
    queries.push(sql`
      INSERT INTO public.client_roles (id, client_id, key, label, color, bucket_family)
      VALUES (${roleIds[i]!}::uuid, ${clientId}::uuid, ${key}, ${r.label}, ${colorForRoleIndex(i)}, 'employees')
    `);
  }
  for (let i = 0; i < data.roles.length; i++) {
    queries.push(sql`
      INSERT INTO public.client_levels (client_id, level_number, label, allowed_role_ids)
      VALUES (${clientId}::uuid, ${i + 1}, ${data.roles[i]!.label}, ${[roleIds[i]!]}::uuid[])
    `);
  }
  for (let i = 0; i < data.roles.length; i++) {
    const r = data.roles[i]!;
    if (r.max_per_parent === null) continue;
    const parentRoleId = i === 0 ? null : roleIds[i - 1]!;
    queries.push(sql`
      INSERT INTO public.client_cardinality_rules (client_id, parent_role_id, child_role_id, max_children)
      VALUES (${clientId}::uuid, ${parentRoleId}::uuid, ${roleIds[i]!}::uuid, ${r.max_per_parent})
    `);
  }
  // Insert nodes in level order (Level 1 first) so parent_id always exists when FK fires.
  const order = [...data.team.keys()].sort((a, b) =>
    (roleIdxByLabel.get(data.team[a]!.role_label) ?? 0) - (roleIdxByLabel.get(data.team[b]!.role_label) ?? 0),
  );
  for (const i of order) {
    const t = data.team[i]!;
    const roleIdx = roleIdxByLabel.get(t.role_label)!;
    const parentRowIdx = t.parent_email
      ? teamByEmail.get(t.parent_email.toLowerCase()) ?? null
      : null;
    const parentNodeId = parentRowIdx === null ? null : teamIds[parentRowIdx]!;
    queries.push(sql`
      INSERT INTO public.user_nodes (
        id, client_id, parent_id, level_number, role_id,
        display_name, email, phone, notes, fields, created_by_admin
      ) VALUES (
        ${teamIds[i]!}::uuid, ${clientId}::uuid, ${parentNodeId}::uuid,
        ${roleIdx + 1}, ${roleIds[roleIdx]!}::uuid,
        ${t.display_name}, ${t.email}, ${t.phone}, ${t.notes}, '{}'::jsonb,
        ${adminId}::uuid
      )
    `);
    queries.push(sql`
      INSERT INTO public.user_node_credentials (
        client_id, user_node_id, email, password_hash, must_change_password,
        temp_password_plain, temp_password_views_left, created_by_admin
      ) VALUES (
        ${clientId}::uuid, ${teamIds[i]!}::uuid, ${t.email},
        ${passwordHashes[i]!}, true, ${finalPasswords[i]!}, 3,
        ${adminId}::uuid
      )
    `);
  }

  try {
    await sql.transaction(queries as never);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    const msg = (e as Error)?.message ?? '';
    if (code === '23505') {
      if (msg.includes('user_node_credentials')) return jsonError(409, 'email_already_has_login');
      if (msg.includes('clients_slug')) return jsonError(422, 'slug_collision');
      return jsonError(409, 'duplicate_row', { sqlstate: code });
    }
    throw e;
  }

  await logAudit(sql, {
    session: { kind: 'admin', admin: { id: adminId, email: actor.admin.email } },
    op: 'client.onboarded_bulk',
    clientId,
    targetType: 'client',
    targetId: clientId,
    detail: {
      name: data.workspace.name,
      role_count: data.roles.length,
      team_count: data.team.length,
      login_count: data.team.length,
      enabled_products_count: data.workspace.enabled_products.length,
      source: 'xlsx_import',
    },
  });

  const ownerNodeIdx = data.team.findIndex((t) => t.role_label === l1RoleLabel);
  return jsonOk({
    client: { id: clientId, name: data.workspace.name, slug },
    owner_node_id: teamIds[ownerNodeIdx]!,
    team_member_count: data.team.length,
    credentials: data.team.map((t, i) => ({
      display_name: t.display_name, email: t.email, temp_password: finalPasswords[i]!,
    })),
  }, { status: 201 });
};

// Workspace data export — query layer.
//
// One function: collectWorkspaceSnapshot(sql, clientId, actor) → WorkspaceSnapshot.
//
// SECURITY INVARIANT: The credentials SELECT list does NOT include
// password_hash, temp_password_plain, or password_reset_requested_at.
// These fields are never read into JS memory inside this function. This
// is the single source of truth for the redaction rule; format branches
// CANNOT accidentally leak them because they don't exist on the object.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { ExportActor, WorkspaceSnapshot } from './workspace-export-types';

type SQL = NeonQueryFunction<false, false>;

export async function collectWorkspaceSnapshot(
  sql: SQL,
  clientId: string,
  actor: ExportActor,
): Promise<WorkspaceSnapshot> {
  // Each query is filtered by client_id to enforce per-tenant isolation.
  // Order chosen so the heaviest queries (user_nodes, files, products) come
  // after the lighter ones — small mercy if a network blip mid-collection
  // surfaces a quick error before we've done much work.
  const [clientRow] = (await sql`
    SELECT * FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Record<string, unknown>[];
  if (!clientRow) {
    throw new Error(`workspace_export: client_not_found ${clientId}`);
  }

  const enabledProductRows = (await sql`
    SELECT product_key FROM public.client_enabled_products
    WHERE client_id = ${clientId}::uuid
    ORDER BY product_key ASC
  `) as { product_key: string }[];

  const levels = (await sql`
    SELECT * FROM public.client_levels
    WHERE client_id = ${clientId}::uuid
    ORDER BY level_number ASC
  `) as Record<string, unknown>[];

  const roles = (await sql`
    SELECT * FROM public.client_roles
    WHERE client_id = ${clientId}::uuid
    ORDER BY key ASC
  `) as Record<string, unknown>[];

  const cardinality_rules = (await sql`
    SELECT * FROM public.client_cardinality_rules
    WHERE client_id = ${clientId}::uuid
    ORDER BY level_number ASC, role_id ASC
  `) as Record<string, unknown>[];

  const user_nodes = (await sql`
    SELECT * FROM public.user_nodes
    WHERE client_id = ${clientId}::uuid
    ORDER BY level_number NULLS FIRST, parent_id NULLS FIRST, sort_order ASC, id ASC
  `) as Record<string, unknown>[];

  // REDACTION: explicit SELECT list, omits password_hash, temp_password_plain,
  // password_reset_requested_at. Keep this list in sync with migration 017
  // (and any later additions to user_node_credentials).
  // Defense-in-depth: even if the DB driver or a test mock returns extra keys,
  // we explicitly strip the three redacted fields before they enter the snapshot.
  const CREDENTIAL_REDACTED_FIELDS = new Set([
    'password_hash',
    'temp_password_plain',
    'password_reset_requested_at',
  ]);
  const rawCredentials = (await sql`
    SELECT id, client_id, user_node_id, email, must_change_password,
           last_login_at, created_at, updated_at, created_by_admin
    FROM public.user_node_credentials
    WHERE client_id = ${clientId}::uuid
    ORDER BY email ASC
  `) as Record<string, unknown>[];
  const credentials = rawCredentials.map((row) => {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!CREDENTIAL_REDACTED_FIELDS.has(k)) safe[k] = v;
    }
    return safe;
  });

  const files = (await sql`
    SELECT * FROM public.files
    WHERE client_id = ${clientId}::uuid
    ORDER BY created_at ASC, id ASC
  `) as Record<string, unknown>[];

  const file_categories = (await sql`
    SELECT * FROM public.file_categories
    WHERE file_id IN (SELECT id FROM public.files WHERE client_id = ${clientId}::uuid)
  `) as Record<string, unknown>[];

  const file_allowed_nodes = (await sql`
    SELECT * FROM public.file_allowed_nodes
    WHERE file_id IN (SELECT id FROM public.files WHERE client_id = ${clientId}::uuid)
  `) as Record<string, unknown>[];

  const file_allowed_roles = (await sql`
    SELECT * FROM public.file_allowed_roles
    WHERE file_id IN (SELECT id FROM public.files WHERE client_id = ${clientId}::uuid)
  `) as Record<string, unknown>[];

  const file_allowed_users = (await sql`
    SELECT * FROM public.file_allowed_users
    WHERE file_id IN (SELECT id FROM public.files WHERE client_id = ${clientId}::uuid)
  `) as Record<string, unknown>[];

  const products = (await sql`
    SELECT * FROM public.products
    WHERE client_id = ${clientId}::uuid
    ORDER BY created_at ASC, id ASC
  `) as Record<string, unknown>[];

  const product_categories = (await sql`
    SELECT * FROM public.product_categories
    WHERE client_id = ${clientId}::uuid
    ORDER BY name ASC
  `) as Record<string, unknown>[];

  const product_images = (await sql`
    SELECT * FROM public.product_images
    WHERE product_id IN (SELECT id FROM public.products WHERE client_id = ${clientId}::uuid)
    ORDER BY product_id ASC, sort_order ASC
  `) as Record<string, unknown>[];

  return {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    exported_by: actor,
    client: clientRow,
    enabled_products: enabledProductRows.map((r) => r.product_key),
    levels,
    roles,
    cardinality_rules,
    user_nodes,
    credentials,
    files: {
      files,
      categories: file_categories,
      allowed_nodes: file_allowed_nodes,
      allowed_roles: file_allowed_roles,
      allowed_users: file_allowed_users,
    },
    products: {
      products,
      categories: product_categories,
      images: product_images,
    },
  };
}

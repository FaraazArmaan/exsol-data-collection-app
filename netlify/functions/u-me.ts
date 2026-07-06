// GET /api/u-me  — returns the authenticated bucket user's identity from
// the bu_session cookie + a fresh load of the user_node row (so display_name
// reflects any admin edits).

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import {
  buCookieHeader, mintBucketUserSession, shouldRefreshBucketUser,
} from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { requireBucketUser, UnauthorizedError, getLevelMatrix } from './_shared/permissions';
import { enabledModulesForProducts } from '@registry/products';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  let actor;
  try { actor = await requireBucketUser(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();
  // Pull has_google off the credential row so the UI can show "Linked" badge.
  const credRows = (await sql`
    SELECT (google_sub IS NOT NULL) AS has_google
    FROM public.user_node_credentials WHERE id = ${actor.credential.id}
  `) as { has_google: boolean }[];
  const hasGoogle = credRows[0]?.has_google ?? false;

  const rows = (await sql`
    SELECT n.id, n.client_id, n.parent_id, n.level_number, n.role_id,
           n.display_name, n.email, n.phone, n.notes, n.fields,
           r.key AS role_key, r.label AS role_label, r.color AS role_color,
           c.slug AS client_slug, c.name AS client_name
    FROM public.user_nodes n
    JOIN public.client_roles r ON r.id = n.role_id
    JOIN public.clients c ON c.id = n.client_id
    WHERE n.id = ${actor.claims.sub}::uuid AND n.client_id = ${actor.claims.client_id}::uuid
    LIMIT 1
  `) as Array<{
    id: string; client_id: string; parent_id: string | null; level_number: number | null;
    role_id: string; display_name: string; email: string | null; phone: string | null;
    notes: string | null; fields: Record<string, unknown>;
    role_key: string; role_label: string; role_color: string;
    client_slug: string; client_name: string;
  }>;
  if (rows.length === 0) return jsonError(404, 'user_node_not_found');
  const row = rows[0]!;

  const levelNumber = row.level_number ?? 1; // legacy rows without a level default to Primary
  const permissions = await getLevelMatrix(row.client_id, levelNumber);

  const enabledProductRows = (await sql`
    SELECT product_key FROM public.client_enabled_products
    WHERE client_id = ${row.client_id}::uuid
  `) as { product_key: string }[];
  const enabledProductKeys = enabledProductRows.map((r) => r.product_key);

  // Modules brought in by the Client's enabled products. Uses
  // enabledModulesForProducts (walks product.modules) rather than
  // derivePermissionRows (walks data_buckets) so action-namespace modules like
  // POS — which declare no data_buckets — still appear.
  const enabledModules = enabledModulesForProducts(enabledProductKeys);

  const headers: Record<string, string> = {};
  if (shouldRefreshBucketUser(actor.claims)) {
    const fresh = await mintBucketUserSession({
      sub: actor.claims.sub,
      email: actor.claims.email,
      client_id: actor.claims.client_id,
    });
    headers['Set-Cookie'] = buCookieHeader(fresh);
  }

  return jsonOk({
    user: {
      id: row.id,
      display_name: row.display_name,
      email: row.email,
      phone: row.phone,
      notes: row.notes,
      fields: row.fields,
      level_number: row.level_number,
      role: { key: row.role_key, label: row.role_label, color: row.role_color },
      must_change_password: actor.credential.must_change_password,
      has_google: hasGoogle,
    },
    client: { id: row.client_id, slug: row.client_slug, name: row.client_name },
    permissions,
    enabled_modules: enabledModules,
  }, { headers });
};

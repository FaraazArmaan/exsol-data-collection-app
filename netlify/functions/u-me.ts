// GET /api/u-me  — returns the authenticated bucket user's identity from
// the bu_session cookie + a fresh load of the bucket row (so display_name
// reflects any admin edits).

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import {
  buCookieHeader, mintBucketUserSession, shouldRefreshBucketUser,
} from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { isValidSchemaName, safeQuoteSchema, safeQuoteIdent } from './_shared/identifier';
import { TEMPLATES } from './_shared/templates';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  let actor;
  try { actor = await requireBucketUser(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();
  const clientRows = (await sql`
    SELECT id, slug, name, schema_name, template_key
    FROM public.clients WHERE id = ${actor.credential.client_id} LIMIT 1
  `) as { id: string; slug: string; name: string; schema_name: string; template_key: string }[];
  const client = clientRows[0];
  if (!client) return jsonError(404, 'client_not_found');
  if (!isValidSchemaName(client.schema_name)) return jsonError(500, 'bad_schema_name');

  const template = TEMPLATES[client.template_key];
  if (!template) return jsonError(500, 'template_missing');
  const role = template.roles.find((r) => r.key === actor.credential.role_key);
  if (!role) return jsonError(500, 'role_missing');

  const schemaId = safeQuoteSchema(client.schema_name);
  const tableId = safeQuoteIdent(actor.credential.role_key);
  const bucketRows = (await sql(
    `SELECT id, display_name, email FROM ${schemaId}.${tableId} WHERE id = $1 LIMIT 1`,
    [actor.credential.bucket_user_id],
  )) as unknown as { id: string; display_name: string; email: string | null }[];
  const bucketRow = bucketRows[0];
  if (!bucketRow) return jsonError(404, 'bucket_user_not_found');

  const headers: Record<string, string> = {};
  if (shouldRefreshBucketUser(actor.claims)) {
    const fresh = await mintBucketUserSession({
      sub: actor.claims.sub,
      email: actor.claims.email,
      client_id: actor.claims.client_id,
      role_key: actor.claims.role_key,
    });
    headers['Set-Cookie'] = buCookieHeader(fresh);
  }

  return jsonOk({
    user: {
      id: bucketRow.id,
      display_name: bucketRow.display_name,
      email: bucketRow.email,
      role_key: actor.credential.role_key,
      role_label: role.label,
      must_change_password: actor.credential.must_change_password,
    },
    client: { id: client.id, slug: client.slug, name: client.name },
  }, { headers });
};

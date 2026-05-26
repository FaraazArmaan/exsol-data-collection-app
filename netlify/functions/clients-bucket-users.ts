// GET ?client=<id>&role=<key>  → { users: BucketRow[] }
// POST ?client=<id>&role=<key>, body: { display_name, email?, phone?, notes?, ...custom columns }
//   → 201 { user: BucketRow } | 409 cardinality | 400 validation

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { TEMPLATES } from './_shared/templates';
import { isValidSchemaName, isValidIdentifier } from './_shared/identifier';
import { Bucket, CardinalityError } from './_shared/bucket';

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client');
  const roleKey = url.searchParams.get('role');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  if (!roleKey || !isValidIdentifier(roleKey)) return jsonError(400, 'validation_failed', 'role required');

  const sql = db();
  const rows = (await sql`
    SELECT template_key, schema_name FROM public.clients
    WHERE id = ${clientId}::uuid LIMIT 1
  `) as { template_key: string; schema_name: string }[];
  const client = rows[0];
  if (!client) return jsonError(404, 'not_found');
  if (!isValidSchemaName(client.schema_name)) return jsonError(500, 'bad_schema_name');

  const template = TEMPLATES[client.template_key];
  if (!template) return jsonError(500, 'template_missing');
  if (!template.roles.find((r) => r.key === roleKey)) return jsonError(404, 'role_not_found');

  const bucket = new Bucket(client.schema_name, template, roleKey);

  if (req.method === 'GET') {
    const users = await bucket.list();
    return jsonOk({ users });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return jsonError(400, 'validation_failed', 'body required');
    try {
      const user = await bucket.add({ actorAdminId: actor.admin.id, values: body as Record<string, unknown> });
      return jsonOk({ user }, { status: 201 });
    } catch (e: unknown) {
      if (e instanceof CardinalityError) return jsonError(409, 'conflict', { role: e.roleKey });
      const msg = (e as Error)?.message ?? 'unknown';
      if (msg.startsWith('validation_failed:')) return jsonError(400, 'validation_failed', msg);
      throw e;
    }
  }

  return jsonError(405, 'method_not_allowed');
};

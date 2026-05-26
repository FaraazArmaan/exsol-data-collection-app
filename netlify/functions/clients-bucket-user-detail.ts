// PATCH ?client=&role=&user=, body: partial fields  → { user: BucketRow }
// DELETE ?client=&role=&user=  → { ok: true }

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { TEMPLATES } from './_shared/templates';
import { isValidSchemaName, isValidIdentifier, assertUuid } from './_shared/identifier';
import { Bucket } from './_shared/bucket';

export default async (req: Request, _ctx: Context) => {
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client');
  const roleKey = url.searchParams.get('role');
  const userId = url.searchParams.get('user');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  if (!roleKey || !isValidIdentifier(roleKey)) return jsonError(400, 'validation_failed', 'role required');
  if (!userId) return jsonError(400, 'validation_failed', 'user required');
  try { assertUuid(userId, 'user'); } catch { return jsonError(400, 'validation_failed', 'user must be uuid'); }

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

  if (req.method === 'PATCH') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return jsonError(400, 'validation_failed', 'body required');
    try {
      const user = await bucket.update(userId, body as Record<string, unknown>);
      return jsonOk({ user });
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? '';
      if (msg === 'not_found') return jsonError(404, 'not_found');
      if (msg.startsWith('validation_failed:')) return jsonError(400, 'validation_failed', msg);
      throw e;
    }
  }

  if (req.method === 'DELETE') {
    try {
      await bucket.remove(userId);
      return jsonOk({ ok: true });
    } catch (e: unknown) {
      if ((e as Error)?.message === 'not_found') return jsonError(404, 'not_found');
      throw e;
    }
  }

  return jsonError(405, 'method_not_allowed');
};

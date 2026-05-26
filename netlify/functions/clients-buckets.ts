import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { TEMPLATES } from './_shared/templates';
import { isValidSchemaName } from './_shared/identifier';
import { Bucket } from './_shared/bucket';

interface BucketSummary {
  role: string;
  label: string;
  cardinality: 'singleton' | 'multi';
  count: number;
  columns: Array<{ key: string; label: string; type: string; required: boolean; display_in_list?: boolean; default?: unknown; help?: string }>;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  try { await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client query param required');

  const sql = db();
  const rows = (await sql`
    SELECT id, name, template_key, schema_name FROM public.clients
    WHERE id = ${clientId}::uuid LIMIT 1
  `) as { id: string; name: string; template_key: string; schema_name: string }[];
  const client = rows[0];
  if (!client) return jsonError(404, 'not_found');
  if (!isValidSchemaName(client.schema_name)) return jsonError(500, 'bad_schema_name');

  const template = TEMPLATES[client.template_key];
  if (!template) return jsonError(500, 'template_missing');

  const buckets: BucketSummary[] = [];
  for (const role of template.roles) {
    const bucket = new Bucket(client.schema_name, template, role.key);
    const count = await bucket.count();
    buckets.push({
      role: role.key,
      label: role.label,
      cardinality: role.cardinality,
      count,
      columns: role.columns,
    });
  }

  return jsonOk({ client: { id: client.id, name: client.name }, buckets });
};

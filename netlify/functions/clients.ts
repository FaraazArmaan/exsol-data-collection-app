import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { TEMPLATES } from './_shared/templates';
import { generateSchemaName } from './_shared/identifier';
import { createClientSchema } from './_shared/schema-manager';

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  template_key: z.string(),
});

interface ClientRow {
  id: string;
  name: string;
  template_key: string;
  template_version_applied: number;
  schema_name: string;
  created_at: string;
}

export default async (req: Request, _ctx: Context) => {
  let actor;
  try {
    actor = await requireAdmin(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, name, template_key, template_version_applied, schema_name, created_at
      FROM public.clients
      ORDER BY created_at DESC
    `) as ClientRow[];
    return jsonOk({ clients: rows });
  }

  if (req.method === 'POST') {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    const template = TEMPLATES[parsed.data.template_key];
    if (!template) return jsonError(400, 'template_unknown');

    // Pre-generate schema name so it can be stored in public.clients before
    // createClientSchema runs (which needs it for the audit log FK).
    const schemaName = generateSchemaName();

    const inserted = (await sql`
      INSERT INTO public.clients (name, template_key, template_version_applied, schema_name, created_by)
      VALUES (${parsed.data.name}, ${template.key}, ${template.version}, ${schemaName}, ${actor.admin.id})
      RETURNING id
    `) as { id: string }[];
    const clientId = inserted[0]!.id;

    try {
      await createClientSchema({
        clientId,
        actorAdminId: actor.admin.id,
        template,
        clientName: parsed.data.name,
        schemaName,
      });
    } catch (e) {
      // Schema creation failed — remove the orphan client row so the DB stays
      // consistent. If cleanup itself fails, log it but do not mask the original error.
      try {
        await sql`DELETE FROM public.clients WHERE id = ${clientId}`;
      } catch (cleanupErr) {
        console.error('clients.ts: orphan client row cleanup failed', clientId, cleanupErr);
      }
      return jsonError(500, 'schema_op_failed', String(e));
    }

    return jsonOk(
      {
        client: {
          id: clientId,
          name: parsed.data.name,
          template_key: template.key,
          template_version_applied: template.version,
          schema_name: schemaName,
        },
      },
      { status: 201 },
    );
  }

  return jsonError(405, 'method_not_allowed');
};

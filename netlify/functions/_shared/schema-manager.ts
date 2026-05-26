import type { NeonQueryPromise } from '@neondatabase/serverless';
import { db } from './db';
import { generateCreateSchema, generateDropSchema } from './template-ddl';
import { assertUuid, generateSchemaName, isValidSchemaName } from './identifier';
import type { TemplateDef } from './templates';

// Split a multi-statement DDL string into individual statements.
// Template DDL never contains $$-quoted bodies (those only appear in
// migrations 005/006), so a semicolon + trailing whitespace/newline is
// always a clean statement boundary here.
function splitStatements(body: string): string[] {
  return body
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s));
}

export interface CreateSchemaInput {
  clientId: string;
  actorAdminId: string;
  template: TemplateDef;
  clientName: string;
  schemaName?: string; // optional: caller pre-generates so they can store it before this runs
}

export async function createClientSchema(
  input: CreateSchemaInput,
): Promise<{ schemaName: string }> {
  assertUuid(input.clientId, 'clientId');
  assertUuid(input.actorAdminId, 'actorAdminId');

  const schemaName = input.schemaName ?? generateSchemaName();
  if (!isValidSchemaName(schemaName)) throw new Error('invalid_schema_name');
  const ddl = generateCreateSchema(schemaName, input.template);
  const sql = db();
  const ddlStmts = splitStatements(ddl);

  // sql(string) overload infers a wider NeonQueryPromise type than <false,false>;
  // cast through unknown → NeonQueryPromise<false,false> to satisfy transaction().
  // Same pattern used in scripts/migrate.ts (Phase 2 precedent).
  const queries = [
    ...ddlStmts.map((stmt) => sql(stmt)),
    sql`INSERT INTO public.schema_ops_log
          (op, client_id, schema_name, template_key, to_version, actor_admin, detail)
        VALUES (
          'create_schema',
          ${input.clientId}::uuid,
          ${schemaName},
          ${input.template.key},
          ${input.template.version},
          ${input.actorAdminId}::uuid,
          ${JSON.stringify(input.template.roles.map((r) => r.key))}::jsonb
        )`,
  ] as unknown as NeonQueryPromise<false, false>[];

  await sql.transaction(queries);
  return { schemaName };
}

export async function dropClientSchema(input: {
  schemaName: string;
  clientId: string | null;
  actorAdminId: string;
}): Promise<void> {
  if (!isValidSchemaName(input.schemaName)) throw new Error('invalid_schema_name');
  assertUuid(input.actorAdminId, 'actorAdminId');
  if (input.clientId !== null) assertUuid(input.clientId, 'clientId');

  const sql = db();
  const dropStmts = splitStatements(generateDropSchema(input.schemaName));

  // clientId may be null — tagged-template handles null correctly (becomes SQL NULL).
  const clientIdVal = input.clientId ?? null;

  const queries = [
    ...dropStmts.map((stmt) => sql(stmt)),
    sql`INSERT INTO public.schema_ops_log (op, client_id, schema_name, actor_admin)
        VALUES (
          'drop_schema',
          ${clientIdVal}::uuid,
          ${input.schemaName},
          ${input.actorAdminId}::uuid
        )`,
  ] as unknown as NeonQueryPromise<false, false>[];

  await sql.transaction(queries);
}

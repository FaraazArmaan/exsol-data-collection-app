import { safeQuoteIdent, safeQuoteSchema } from './identifier';
import type { ColumnDef, ColumnType, RoleDef, TemplateDef } from './templates';

const SHARED_CORE = `
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text NOT NULL,
  email           citext,
  phone           text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL REFERENCES public.admins(id)
`.trim();

function sqlType(t: ColumnType): string {
  switch (t) {
    case 'text':    return 'text';
    case 'date':    return 'date';
    case 'integer': return 'integer';
    case 'boolean': return 'boolean';
  }
}

function columnDdl(c: ColumnDef): string {
  const parts = [safeQuoteIdent(c.key), sqlType(c.type)];
  if (c.required) parts.push('NOT NULL');
  if (c.default !== undefined) {
    const v = c.type === 'boolean'
      ? (c.default ? 'true' : 'false')
      : c.type === 'integer'
        ? String(c.default)
        : `'${String(c.default).replace(/'/g, "''")}'`;
    parts.push(`DEFAULT ${v}`);
  }
  return parts.join(' ');
}

export function generateCreateRoleTable(schemaName: string, role: RoleDef): string {
  const schema = safeQuoteSchema(schemaName);
  const table = safeQuoteIdent(role.key);
  const customCols = role.columns.map(columnDdl);
  const colLines = [SHARED_CORE, ...customCols, 'UNIQUE NULLS NOT DISTINCT (email)']
    .map((s) => '  ' + s).join(',\n');

  const stmts: string[] = [
    `CREATE TABLE ${schema}.${table} (\n${colLines}\n);`,
    `CREATE INDEX ${safeQuoteIdent(role.key + '_created_at_idx')} ON ${schema}.${table} (created_at DESC);`,
  ];
  if (role.cardinality === 'singleton') {
    stmts.push(`CREATE UNIQUE INDEX ${safeQuoteIdent(role.key + '_singleton')} ON ${schema}.${table} ((true));`);
  }
  return stmts.join('\n');
}

export function generateCreateSchema(schemaName: string, template: TemplateDef): string {
  const schema = safeQuoteSchema(schemaName);
  const parts: string[] = [
    `CREATE SCHEMA ${schema};`,
    `CREATE TABLE ${schema}._meta (\n  template_version_applied integer NOT NULL,\n  created_at timestamptz NOT NULL DEFAULT now()\n);`,
    `INSERT INTO ${schema}._meta (template_version_applied) VALUES (${template.version});`,
    ...template.roles.map((r) => generateCreateRoleTable(schemaName, r)),
  ];
  return parts.join('\n\n');
}

export function generateDropSchema(schemaName: string): string {
  return `DROP SCHEMA ${safeQuoteSchema(schemaName)} CASCADE;`;
}

export function generateAddColumn(schemaName: string, role: RoleDef, column: ColumnDef): string {
  return `ALTER TABLE ${safeQuoteSchema(schemaName)}.${safeQuoteIdent(role.key)} ADD COLUMN ${columnDdl(column)};`;
}

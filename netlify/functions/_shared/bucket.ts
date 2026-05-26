import { db } from './db';
import { safeQuoteIdent, safeQuoteSchema } from './identifier';
import type { RoleDef, TemplateDef, ColumnDef } from './templates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BucketRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  [key: string]: unknown;
}

export class CardinalityError extends Error {
  constructor(public roleKey: string) {
    super(`singleton_full:${roleKey}`);
    this.name = 'CardinalityError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findRole(template: TemplateDef, roleKey: string): RoleDef {
  const r = template.roles.find((x) => x.key === roleKey);
  if (!r) throw new Error(`unknown_role:${roleKey}`);
  return r;
}

function selectColumns(role: RoleDef): string {
  const cols = [
    'id',
    'display_name',
    'email',
    'phone',
    'notes',
    'created_at',
    'updated_at',
    'created_by',
    ...role.columns.map((c) => c.key),
  ];
  return cols.map(safeQuoteIdent).join(', ');
}

// ---------------------------------------------------------------------------
// Bucket class
// ---------------------------------------------------------------------------

export class Bucket {
  constructor(
    public readonly schemaName: string,
    public readonly template: TemplateDef,
    public readonly roleKey: string,
  ) {}

  /** Fully-qualified table reference — already safely quoted. */
  private fq(): string {
    return `${safeQuoteSchema(this.schemaName)}.${safeQuoteIdent(this.roleKey)}`;
  }

  async list(): Promise<BucketRow[]> {
    const role = findRole(this.template, this.roleKey);
    const sql = db();
    // Dynamic identifier is already quoted; no parameters needed — use plain sql(string).
    return (await sql(
      `SELECT ${selectColumns(role)} FROM ${this.fq()} ORDER BY created_at DESC`,
    )) as unknown as BucketRow[];
  }

  async count(): Promise<number> {
    const sql = db();
    const rows = (await sql(
      `SELECT COUNT(*)::int AS n FROM ${this.fq()}`,
    )) as unknown as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  async add(input: {
    actorAdminId: string;
    values: Record<string, unknown>;
  }): Promise<BucketRow> {
    assertUuid(input.actorAdminId);
    const role = findRole(this.template, this.roleKey);

    // Enforce singleton cardinality before insert.
    if (role.cardinality === 'singleton' && (await this.count()) >= 1) {
      throw new CardinalityError(this.roleKey);
    }

    const { columns, placeholders, params } = this.buildInsert(
      role,
      input.values,
      input.actorAdminId,
    );
    const sql = db();
    // INSERT with parameterized values; fq() is already quoted identifier.
    const rows = (await sql(
      `INSERT INTO ${this.fq()} (${columns}) VALUES (${placeholders}) RETURNING ${selectColumns(role)}`,
      params,
    )) as unknown as BucketRow[];
    return rows[0]!;
  }

  async update(userId: string, values: Record<string, unknown>): Promise<BucketRow> {
    assertUuid(userId);
    const role = findRole(this.template, this.roleKey);
    const { setClauses, params } = this.buildUpdate(role, values);

    if (setClauses.length === 0) {
      // Nothing to update — fetch and return the current row.
      // Use sql(string, params) because we need a dynamic identifier (fq()) + a param ($1).
      const sql = db();
      const rows = (await sql(
        `SELECT ${selectColumns(role)} FROM ${this.fq()} WHERE id = $1`,
        [userId],
      )) as unknown as BucketRow[];
      const row = rows[0];
      if (!row) throw new Error('not_found');
      return row;
    }

    const sql = db();
    params.push(userId);
    const rows = (await sql(
      `UPDATE ${this.fq()} SET ${setClauses.join(', ')}, "updated_at" = now() WHERE id = $${params.length} RETURNING ${selectColumns(role)}`,
      params,
    )) as unknown as BucketRow[];
    const row = rows[0];
    if (!row) throw new Error('not_found');
    return row;
  }

  async remove(userId: string): Promise<void> {
    assertUuid(userId);
    const sql = db();
    // DELETE with parameterized id; fq() is already quoted identifier.
    // Cannot use tagged template here because we need to embed fq() as raw SQL
    // while also parameterizing userId. Use sql(string, params) overload.
    const rows = (await sql(
      `DELETE FROM ${this.fq()} WHERE id = $1 RETURNING id`,
      [userId],
    )) as unknown as { id: string }[];
    if (rows.length === 0) throw new Error('not_found');
  }

  // ---------------------------------------------------------------------------
  // Private builders
  // ---------------------------------------------------------------------------

  private buildInsert(
    role: RoleDef,
    values: Record<string, unknown>,
    actorAdminId: string,
  ): { columns: string; placeholders: string; params: unknown[] } {
    const fields: { col: string; val: unknown }[] = [];
    const coreCols: (keyof BucketRow & string)[] = [
      'display_name',
      'email',
      'phone',
      'notes',
    ];

    for (const c of coreCols) {
      if (
        c === 'display_name' &&
        (values[c] === undefined || values[c] === null || values[c] === '')
      ) {
        throw new Error('validation_failed:display_name_required');
      }
      fields.push({ col: c, val: values[c] ?? null });
    }

    for (const c of role.columns) {
      const v = values[c.key];
      if (c.required && (v === undefined || v === null || v === '')) {
        throw new Error(`validation_failed:${c.key}_required`);
      }
      fields.push({ col: c.key, val: v ?? c.default ?? null });
    }

    fields.push({ col: 'created_by', val: actorAdminId });

    const columns = fields.map((f) => safeQuoteIdent(f.col)).join(', ');
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
    const params = fields.map((f) => f.val);
    return { columns, placeholders, params };
  }

  private buildUpdate(
    role: RoleDef,
    values: Record<string, unknown>,
  ): { setClauses: string[]; params: unknown[] } {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    const allowed = new Set<string>([
      'display_name',
      'email',
      'phone',
      'notes',
      ...role.columns.map((c) => c.key),
    ]);
    const requiredCustom = new Set(
      role.columns.filter((c) => c.required).map((c) => c.key),
    );

    for (const [k, v] of Object.entries(values)) {
      if (!allowed.has(k)) continue;
      if ((k === 'display_name' || requiredCustom.has(k)) && (v === null || v === '')) {
        throw new Error(`validation_failed:${k}_required`);
      }
      params.push(v);
      setClauses.push(`${safeQuoteIdent(k)} = $${params.length}`);
    }

    return { setClauses, params };
  }
}

// ---------------------------------------------------------------------------
// Module-level UUID guard
// ---------------------------------------------------------------------------

function assertUuid(s: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new Error('invalid_uuid');
  }
}

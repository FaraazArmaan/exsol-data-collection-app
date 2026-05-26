/**
 * Integration tests for schema-manager (Task 5.4) and Bucket abstraction (Task 5.5).
 *
 * Runs against the Neon dev branch (DATABASE_URL from .env).
 * Each test gets a freshly-created ephemeral schema (beforeEach/afterEach).
 *
 * schema_ops_log.client_id has a FK to public.clients(id), so beforeEach inserts
 * an ephemeral client row and uses its id as clientId. The row is deleted in afterEach.
 * public.clients.schema_name is NOT set to the test schema (Phase 6 wires that up);
 * we use a placeholder that satisfies the CHECK constraint pattern.
 *
 * ENV loading: handled by tests/setup-env.ts (vitest setupFile).
 *
 * Bootstrap admin seeding assumption: theexsolenterprise@gmail.com is already
 * present in the dev branch (seeded at project init). We DO NOT create or delete
 * this admin row — we only fetch its id.
 */

import { neon } from '@neondatabase/serverless';
import { createClientSchema, dropClientSchema } from '../../netlify/functions/_shared/schema-manager';
import { Bucket, CardinalityError } from '../../netlify/functions/_shared/bucket';
import { TEMPLATES } from '../../netlify/functions/_shared/templates';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOOTSTRAP_EMAIL = 'theexsolenterprise@gmail.com';
const CTX_SCHEMA_PREFIX = /^client_[0-9a-f]{32}$/;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let sql: ReturnType<typeof neon>;
let actorAdminId: string;

// Track created schemas and client rows so afterAll can clean up any stragglers.
const createdSchemas: string[] = [];
const createdClientIds: string[] = [];

// Per-test ephemeral schema (set by beforeEach, torn down by afterEach).
let testSchemaName: string;
let testClientId: string;


// ---------------------------------------------------------------------------
// beforeAll / afterAll
// ---------------------------------------------------------------------------

beforeAll(async () => {
  sql = neon(process.env.DATABASE_URL!);

  // Fetch the bootstrap admin id — DO NOT create or modify it.
  const rows = (await sql`
    SELECT id FROM public.admins WHERE email = ${BOOTSTRAP_EMAIL}
  `) as { id: string }[];

  if (rows.length === 0) {
    throw new Error(
      `Bootstrap admin ${BOOTSTRAP_EMAIL} not found in dev DB. ` +
      `Cannot run schema-bucket integration tests without actorAdminId.`,
    );
  }
  actorAdminId = rows[0]!.id;
});

afterAll(async () => {
  // Clean up any schemas that were not properly dropped (e.g. if a test crashed).
  for (const schemaName of createdSchemas) {
    try {
      await sql(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } catch {
      // Best-effort — ignore errors in afterAll cleanup.
    }
  }
  // Clean up any orphaned client rows.
  for (const clientId of createdClientIds) {
    try {
      await sql`DELETE FROM public.clients WHERE id = ${clientId}::uuid`;
    } catch {
      // Best-effort.
    }
  }
});

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Insert an ephemeral client row so the schema_ops_log FK is satisfied.
  // schema_name in public.clients must match ^client_[0-9a-f]{32}$ and be UNIQUE.
  // We'll update it to the real schemaName after createClientSchema returns.
  // For simplicity: generate the schemaName first via identifier helper,
  // then insert the client row with that schema_name, then create the schema.
  const { generateSchemaName } = await import(
    '../../netlify/functions/_shared/identifier'
  );
  const pregenSchema = generateSchemaName();

  const clientRows = (await sql`
    INSERT INTO public.clients (name, template_key, template_version_applied, schema_name, created_by)
    VALUES ('Test Shop (integration)', 'shop', 1, ${pregenSchema}, ${actorAdminId})
    RETURNING id
  `) as { id: string }[];
  testClientId = clientRows[0]!.id;
  createdClientIds.push(testClientId);

  const result = await createClientSchema({
    clientId: testClientId,
    actorAdminId,
    template: TEMPLATES.shop!,
    clientName: 'Test Shop',
  });
  testSchemaName = result.schemaName;
  createdSchemas.push(testSchemaName);
});

afterEach(async () => {
  // Drop the ephemeral schema (best-effort).
  try {
    await dropClientSchema({
      schemaName: testSchemaName,
      clientId: testClientId,
      actorAdminId,
    });
  } catch {
    // If the test already dropped it (e.g. Test 1), suppress the error.
  }
  // Remove schema from stragglers list.
  const schemaIdx = createdSchemas.indexOf(testSchemaName);
  if (schemaIdx >= 0) createdSchemas.splice(schemaIdx, 1);

  // Delete the ephemeral client row (best-effort).
  try {
    await sql`DELETE FROM public.clients WHERE id = ${testClientId}::uuid`;
  } catch {
    // best-effort
  }
  const clientIdx = createdClientIds.indexOf(testClientId);
  if (clientIdx >= 0) createdClientIds.splice(clientIdx, 1);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('schema-manager + Bucket integration', () => {

  // ── Test 1: createClientSchema → verify schema + tables → dropClientSchema → verify gone ──
  it('createClientSchema creates schema/tables; dropClientSchema removes them', async () => {
    // Schema name has expected format.
    expect(testSchemaName).toMatch(CTX_SCHEMA_PREFIX);

    // Verify schema exists in pg_catalog.
    const schemaRows = (await sql`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name = ${testSchemaName}
    `) as { schema_name: string }[];
    expect(schemaRows).toHaveLength(1);

    // Verify shop template tables exist: owners, employees, customers, _meta.
    const tableRows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${testSchemaName}
      ORDER BY table_name
    `) as { table_name: string }[];
    const tableNames = tableRows.map((r) => r.table_name).sort();
    expect(tableNames).toContain('_meta');
    expect(tableNames).toContain('owners');
    expect(tableNames).toContain('employees');
    expect(tableNames).toContain('customers');

    // Verify audit log entry was created.
    const logRows = (await sql`
      SELECT op, schema_name FROM public.schema_ops_log
      WHERE schema_name = ${testSchemaName} AND op = 'create_schema'
    `) as { op: string; schema_name: string }[];
    expect(logRows).toHaveLength(1);

    // Drop — done in afterEach, but do it explicitly here to verify it works.
    await dropClientSchema({
      schemaName: testSchemaName,
      clientId: testClientId,
      actorAdminId,
    });

    // Schema should be gone.
    const goneRows = (await sql`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name = ${testSchemaName}
    `) as { schema_name: string }[];
    expect(goneRows).toHaveLength(0);

    // Verify drop audit log entry.
    const dropLogRows = (await sql`
      SELECT op FROM public.schema_ops_log
      WHERE schema_name = ${testSchemaName} AND op = 'drop_schema'
    `) as { op: string }[];
    expect(dropLogRows).toHaveLength(1);

    // Remove from afterEach straggler lists since we already dropped.
    const idx = createdSchemas.indexOf(testSchemaName);
    if (idx >= 0) createdSchemas.splice(idx, 1);

    // Clean up the client row too (afterEach will still try but will no-op).
    await sql`DELETE FROM public.clients WHERE id = ${testClientId}::uuid`;
    const clientIdx = createdClientIds.indexOf(testClientId);
    if (clientIdx >= 0) createdClientIds.splice(clientIdx, 1);
  });

  // ── Test 2: Bucket.list returns empty array on fresh schema ──────────────
  it('Bucket.list returns [] on a fresh schema', async () => {
    const bucket = new Bucket(testSchemaName, TEMPLATES.shop!, 'employees');
    const rows = await bucket.list();
    expect(rows).toEqual([]);
  });

  // ── Test 3: Bucket.add a row to a multi role → list returns 1 row ────────
  it('Bucket.add inserts a row; list returns it', async () => {
    const bucket = new Bucket(testSchemaName, TEMPLATES.shop!, 'employees');
    const added = await bucket.add({
      actorAdminId,
      values: {
        display_name: 'Alice Smith',
        email: 'alice@example.com',
        position: 'Manager',
        active: true,
      },
    });

    expect(added.id).toBeTruthy();
    expect(added.display_name).toBe('Alice Smith');
    expect(added.email).toBe('alice@example.com');
    expect((added as Record<string, unknown>).position).toBe('Manager');
    expect(added.created_by).toBe(actorAdminId);

    const list = await bucket.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(added.id);
  });

  // ── Test 4: Bucket.add second row to singleton → throws CardinalityError ──
  it('Bucket.add: second row in a singleton role throws CardinalityError', async () => {
    const bucket = new Bucket(testSchemaName, TEMPLATES.shop!, 'owners');

    // First insert succeeds.
    await bucket.add({
      actorAdminId,
      values: { display_name: 'Owner One' },
    });

    // Second insert must throw CardinalityError.
    await expect(
      bucket.add({
        actorAdminId,
        values: { display_name: 'Owner Two' },
      }),
    ).rejects.toThrow(CardinalityError);
  });

  // ── Test 5: clinic.doctors — singleton with 3 custom columns ─────────────
  // This is the highest-risk surface flagged by the Chunk A reviewer:
  // singleton + custom columns must both enforce cardinality AND persist extra fields.
  it('clinic.doctors: singleton with custom columns — 1st insert succeeds, 2nd throws CardinalityError', async () => {
    // Create a real client row for this test to satisfy the FK.
    const { generateSchemaName } = await import(
      '../../netlify/functions/_shared/identifier'
    );
    const clinicPregenSchema = generateSchemaName();
    const clinicClientRows = (await sql`
      INSERT INTO public.clients (name, template_key, template_version_applied, schema_name, created_by)
      VALUES ('Test Clinic (integration)', 'clinic', 1, ${clinicPregenSchema}, ${actorAdminId})
      RETURNING id
    `) as { id: string }[];
    const clinicClientId = clinicClientRows[0]!.id;
    createdClientIds.push(clinicClientId);

    const clinicResult = await createClientSchema({
      clientId: clinicClientId,
      actorAdminId,
      template: TEMPLATES.clinic!,
      clientName: 'Test Clinic',
    });
    const clinicSchema = clinicResult.schemaName;
    createdSchemas.push(clinicSchema);

    try {
      const bucket = new Bucket(clinicSchema, TEMPLATES.clinic!, 'doctors');

      // 1st doctor insert — should succeed and persist custom columns.
      const doctor = await bucket.add({
        actorAdminId,
        values: {
          display_name: 'Dr. Jane Doe',
          email: 'dr.jane@clinic.example.com',
          specialty: 'Cardiology',         // required custom column
          license_no: 'LIC-001',           // optional custom column
          years_practising: 12,            // optional custom column
        },
      });

      expect(doctor.display_name).toBe('Dr. Jane Doe');
      expect((doctor as Record<string, unknown>).specialty).toBe('Cardiology');
      expect((doctor as Record<string, unknown>).license_no).toBe('LIC-001');
      expect((doctor as Record<string, unknown>).years_practising).toBe(12);

      // Count must be 1.
      const count = await bucket.count();
      expect(count).toBe(1);

      // 2nd doctor insert must throw CardinalityError.
      await expect(
        bucket.add({
          actorAdminId,
          values: {
            display_name: 'Dr. John Smith',
            specialty: 'Neurology',
          },
        }),
      ).rejects.toThrow(CardinalityError);

      // Count still 1 after failed insert.
      const countAfter = await bucket.count();
      expect(countAfter).toBe(1);
    } finally {
      // Drop clinic schema.
      await dropClientSchema({
        schemaName: clinicSchema,
        clientId: clinicClientId,
        actorAdminId,
      });
      const schemaIdx = createdSchemas.indexOf(clinicSchema);
      if (schemaIdx >= 0) createdSchemas.splice(schemaIdx, 1);

      // Delete clinic client row.
      await sql`DELETE FROM public.clients WHERE id = ${clinicClientId}::uuid`;
      const clientIdx = createdClientIds.indexOf(clinicClientId);
      if (clientIdx >= 0) createdClientIds.splice(clientIdx, 1);
    }
  }, 30_000);

  // ── Test 6: Bucket.update changes specified fields, leaves others ─────────
  it('Bucket.update: changes only specified fields', async () => {
    const bucket = new Bucket(testSchemaName, TEMPLATES.shop!, 'employees');

    const original = await bucket.add({
      actorAdminId,
      values: {
        display_name: 'Bob Jones',
        email: 'bob@example.com',
        position: 'Cashier',
        active: true,
      },
    });

    // Update only display_name.
    const updated = await bucket.update(original.id, {
      display_name: 'Robert Jones',
    });

    expect(updated.id).toBe(original.id);
    expect(updated.display_name).toBe('Robert Jones');
    expect(updated.email).toBe('bob@example.com'); // unchanged
    expect((updated as Record<string, unknown>).position).toBe('Cashier'); // unchanged
    expect((updated as Record<string, unknown>).active).toBe(true); // unchanged
    // updated_at should be >= created_at
    expect(new Date(updated.updated_at) >= new Date(original.created_at)).toBe(true);
  });

  // ── Test 7: Bucket.remove deletes the row ────────────────────────────────
  it('Bucket.remove deletes the row; re-list is empty', async () => {
    const bucket = new Bucket(testSchemaName, TEMPLATES.shop!, 'customers');

    const row = await bucket.add({
      actorAdminId,
      values: { display_name: 'Carol White' },
    });

    await bucket.remove(row.id);

    const list = await bucket.list();
    expect(list).toHaveLength(0);
  });

  // ── Test 8: add → update → remove round-trip on a multi role ─────────────
  it('Bucket round-trip: add → update → remove on employees (multi role)', async () => {
    const bucket = new Bucket(testSchemaName, TEMPLATES.shop!, 'employees');

    // Add.
    const added = await bucket.add({
      actorAdminId,
      values: {
        display_name: 'Dave Brown',
        position: 'Stock',
        active: false,
      },
    });
    expect(added.display_name).toBe('Dave Brown');

    // Update.
    const updated = await bucket.update(added.id, {
      active: true,
      phone: '555-1234',
    });
    expect((updated as Record<string, unknown>).active).toBe(true);
    expect(updated.phone).toBe('555-1234');
    expect(updated.display_name).toBe('Dave Brown'); // unchanged

    // Remove.
    await bucket.remove(added.id);

    // Confirm gone.
    const list = await bucket.list();
    expect(list.find((r) => r.id === added.id)).toBeUndefined();
  });

  // ── Test 9: dropClientSchema on nonexistent schema raises PG error ────────
  it('dropClientSchema on nonexistent schema raises a PG error (not silent)', async () => {
    // Use a freshly-generated schema name that was never created.
    const { generateSchemaName } = await import(
      '../../netlify/functions/_shared/identifier'
    );
    const fakeSchema = generateSchemaName();

    await expect(
      dropClientSchema({
        schemaName: fakeSchema,
        clientId: null,
        actorAdminId,
      }),
    ).rejects.toThrow(); // PG will throw "schema does not exist"
  });

});

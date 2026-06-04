// scripts/clean-test-fixtures.ts
//
// Deletes accumulated test-fixture workspaces from whatever DB the env's
// DATABASE_URL points at.
//
// Safety: echoes the host upfront and lists "REAL" (non-test) clients that
// will be PRESERVED before doing anything destructive. Per saved memory
// feedback_verify_neon_endpoint_before_drop.
//
// FK handling: audit_log.actor_user_node has NO cascade. Before deleting
// clients we first delete audit_log rows whose actor_user_node points at a
// user_node we're about to delete. Otherwise the cascade trips the FK
// (see saved memory project_team_fk_on_delete_followup).
//
// Run: npx tsx --env-file=.env scripts/clean-test-fixtures.ts

import { neon } from '@neondatabase/serverless';

// Each tuple is (kind, pattern). 'like' uses LIKE; 'eq' uses exact match.
const PATTERNS: Array<{ kind: 'like' | 'eq'; value: string }> = [
  { kind: 'like', value: 'Nodes Test%' },
  { kind: 'like', value: 'UN Auth Test%' },
  { kind: 'like', value: 'Move Test%' },
  { kind: 'like', value: 'Bulk Test%' },
  { kind: 'like', value: 'Onboard Bulk%' },
  { kind: 'like', value: 'Dummy%' },
  { kind: 'like', value: 'bulk-role-test%' },
  { kind: 'like', value: 'Other %' },
  { kind: 'like', value: 'CLP Test%' },
  { kind: 'like', value: 'PMW Test%' },
  { kind: 'like', value: 'Structure Test%' },
  { kind: 'like', value: 'ACP Test%' },
  { kind: 'eq',   value: 'Detail Test Co' },
  { kind: 'eq',   value: 'Smoke Test Wizard' },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const host = url.replace(/.*@/, '').replace(/\/.*/, '');
  console.log(`Target host: ${host}\n`);

  const sql = neon(url);

  // Build the matching predicate as a single SQL OR chain so we can reuse it.
  // Neon's tagged template doesn't compose well via concatenation, so we'll
  // run two parallel queries that both list the same set.

  const total = (await sql`SELECT count(*)::int AS c FROM public.clients`) as { c: number }[];
  console.log(`Total clients before: ${total[0]!.c}`);

  const matchingIds = (await sql`
    SELECT id, name FROM public.clients
    WHERE name LIKE 'Nodes Test%'
       OR name LIKE 'UN Auth Test%'
       OR name LIKE 'Move Test%'
       OR name LIKE 'Bulk Test%'
       OR name LIKE 'Onboard Bulk%'
       OR name LIKE 'Dummy%'
       OR name LIKE 'bulk-role-test%'
       OR name LIKE 'Other %'
       OR name LIKE 'CLP Test%'
       OR name LIKE 'PMW Test%'
       OR name LIKE 'Structure Test%'
       OR name LIKE 'ACP Test%'
       OR name = 'Detail Test Co'
       OR name = 'Smoke Test Wizard'
  `) as { id: string; name: string }[];
  console.log(`Matching test-fixture: ${matchingIds.length}`);

  const real = (await sql`
    SELECT name, slug, created_at FROM public.clients
    WHERE name NOT LIKE 'Nodes Test%'
      AND name NOT LIKE 'UN Auth Test%'
      AND name NOT LIKE 'Move Test%'
      AND name NOT LIKE 'Bulk Test%'
      AND name NOT LIKE 'Onboard Bulk%'
      AND name NOT LIKE 'Dummy%'
      AND name NOT LIKE 'bulk-role-test%'
      AND name NOT LIKE 'Other %'
      AND name NOT LIKE 'CLP Test%'
      AND name NOT LIKE 'PMW Test%'
      AND name NOT LIKE 'Structure Test%'
      AND name NOT LIKE 'ACP Test%'
      AND name != 'Detail Test Co'
      AND name != 'Smoke Test Wizard'
    ORDER BY created_at
  `) as { name: string; slug: string; created_at: Date | string }[];
  console.log(`\nREAL clients (will be PRESERVED): ${real.length}`);
  for (const r of real) {
    const t = typeof r.created_at === 'string' ? r.created_at : (r.created_at as Date).toISOString();
    console.log(`  KEEP  ${t.slice(0,19)}  ${r.name}  (${r.slug})`);
  }

  if (matchingIds.length === 0) {
    console.log('\nNothing to delete — done.');
    return;
  }

  const ids = matchingIds.map((r) => r.id);

  // Step 1: clear audit_log rows that would break FK cascade.
  // (a) audit_log rows ABOUT a test client (client_id IN ids)
  // (b) audit_log rows whose actor_user_node lives inside a test client
  //     (because deleting the client cascades to user_nodes, orphaning the FK)
  console.log(`\nStep 1: pruning audit_log entries that would break FK cascade…`);
  const auditClientDel = (await sql`
    DELETE FROM public.audit_log WHERE client_id = ANY(${ids}::uuid[])
    RETURNING id
  `) as { id: number }[];
  console.log(`  audit_log rows tied to test client_id: ${auditClientDel.length} removed`);

  const auditActorDel = (await sql`
    DELETE FROM public.audit_log
    WHERE actor_user_node IN (
      SELECT id FROM public.user_nodes WHERE client_id = ANY(${ids}::uuid[])
    )
    RETURNING id
  `) as { id: number }[];
  console.log(`  audit_log rows referencing soon-to-be-deleted user_nodes: ${auditActorDel.length} removed`);

  // Step 2: delete the clients (FK cascade handles user_nodes, credentials,
  // roles, levels, cardinality_rules, products, etc).
  console.log(`\nStep 2: deleting ${ids.length} test-fixture clients…`);
  const delRes = (await sql`
    DELETE FROM public.clients WHERE id = ANY(${ids}::uuid[]) RETURNING id
  `) as { id: string }[];
  console.log(`  Deleted: ${delRes.length} client rows.`);

  const afterTotal = (await sql`SELECT count(*)::int AS c FROM public.clients`) as { c: number }[];
  console.log(`\nTotal clients after: ${afterTotal[0]!.c}`);

  const adminCount = (await sql`SELECT count(*)::int AS c FROM public.admins`) as { c: number }[];
  const auditCount = (await sql`SELECT count(*)::int AS c FROM public.audit_log`) as { c: number }[];
  console.log(`audit_log rows remaining: ${auditCount[0]!.c}`);
  console.log(`admins rows:              ${adminCount[0]!.c}  (untouched)`);
}

void main().catch((e) => { console.error('FAILED:', (e as Error).message); process.exit(1); });

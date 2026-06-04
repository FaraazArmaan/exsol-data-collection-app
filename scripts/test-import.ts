// scripts/test-import.ts
// Standalone smoke test for the XLSX onboarding import path.
//
// Builds a realistic filled template in-memory, runs it through the same
// parser the UI uses, then calls the onboard-client-bulk handler directly
// with a bootstrap-admin cookie. Reports the result and cleans up.
//
// Run: npx tsx --env-file=.env scripts/test-import.ts

import * as XLSX from 'xlsx';
import { neon } from '@neondatabase/serverless';
import type { Context } from '@netlify/functions';
import loginHandler from '../netlify/functions/auth-login';
import bulkHandler from '../netlify/functions/onboard-client-bulk';
import { parseTemplateXlsx } from '../src/modules/shared/onboarding-import/template-parser';

const CTX = {} as Context;
const TS = Date.now();

function buildDummyXlsx(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Workspace name', 'Enabled products'],
    [`Dummy Saloon ${TS}`, 'saloon-booking'],
  ]), 'Workspace');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Role', 'Max per parent'],
    ['Owner', 1],
    ['Manager', 3],
    ['Stylist', 5],
  ]), 'Roles');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Display name', 'Role', 'Parent email', 'Email', 'Phone', 'Notes', 'Temp password'],
    ['Faraaz Owner',  'Owner',   null,                       `owner-${TS}@dummy.com`,  null, null, null],
    ['Aisha Manager', 'Manager', `owner-${TS}@dummy.com`,    `mgr1-${TS}@dummy.com`,   null, null, null],
    ['Bilal Manager', 'Manager', `owner-${TS}@dummy.com`,    `mgr2-${TS}@dummy.com`,   null, null, null],
    ['Sam Stylist',   'Stylist', `mgr1-${TS}@dummy.com`,     `stl1-${TS}@dummy.com`,   null, null, null],
    ['Priya Stylist', 'Stylist', `mgr1-${TS}@dummy.com`,     `stl2-${TS}@dummy.com`,   null, null, null],
    ['Ravi Stylist',  'Stylist', `mgr2-${TS}@dummy.com`,     `stl3-${TS}@dummy.com`,   null, null, null],
  ]), 'Team');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

async function main() {
  console.log('━━━ XLSX onboarding import smoke test ━━━\n');

  console.log('1. Build dummy XLSX in-memory');
  const buf = buildDummyXlsx();
  console.log(`   ✓ ${buf.byteLength} bytes\n`);

  console.log('2. Parse via parseTemplateXlsx (same as browser)');
  const parsed = parseTemplateXlsx(buf);
  console.log(`   ✓ ${parsed.errors.length} parse errors, ${parsed.template?.team.length ?? 0} team rows, ${parsed.template?.roles.length ?? 0} roles`);
  if (!parsed.template) {
    console.error('   ✗ Parse failed fatally — aborting');
    console.error(parsed.errors);
    process.exit(1);
  }
  console.log();

  console.log('3. Log in as bootstrap admin');
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL!;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD!;
  if (!email || !password) {
    console.error('   ✗ BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD missing from env');
    process.exit(1);
  }
  const loginRes = await loginHandler(
    new Request('http://localhost/api/auth-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    CTX,
  );
  if (loginRes.status !== 200) {
    console.error(`   ✗ Login failed: ${loginRes.status} ${await loginRes.text()}`);
    process.exit(1);
  }
  const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]!;
  console.log(`   ✓ ${cookie.slice(0, 40)}…\n`);

  console.log('4. POST /api/onboard-client-bulk');
  const t0 = Date.now();
  const submitRes = await bulkHandler(
    new Request('http://localhost/api/onboard-client-bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(parsed.template),
    }),
    CTX,
  );
  const ms = Date.now() - t0;
  console.log(`   status: ${submitRes.status} (${ms}ms)`);
  const body = await submitRes.json() as Record<string, unknown>;
  if (submitRes.status !== 201) {
    console.error('   ✗ Submit failed');
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log(`   ✓ client: ${(body.client as { name: string }).name} (slug: ${(body.client as { slug: string }).slug})`);
  console.log(`   ✓ team_member_count: ${body.team_member_count}`);
  console.log(`   ✓ credentials returned: ${(body.credentials as unknown[]).length}`);
  console.log();

  console.log('5. Verify DB rows');
  const sql = neon(process.env.DATABASE_URL!);
  const clientId = (body.client as { id: string }).id;
  const roleCount = (await sql`SELECT count(*)::int AS c FROM public.client_roles WHERE client_id = ${clientId}::uuid`) as { c: number }[];
  const levelCount = (await sql`SELECT count(*)::int AS c FROM public.client_levels WHERE client_id = ${clientId}::uuid`) as { c: number }[];
  const cardCount = (await sql`SELECT count(*)::int AS c FROM public.client_cardinality_rules WHERE client_id = ${clientId}::uuid`) as { c: number }[];
  const nodeCount = (await sql`SELECT count(*)::int AS c FROM public.user_nodes WHERE client_id = ${clientId}::uuid`) as { c: number }[];
  const credCount = (await sql`SELECT count(*)::int AS c FROM public.user_node_credentials WHERE client_id = ${clientId}::uuid`) as { c: number }[];
  const auditRow = (await sql`
    SELECT op, detail FROM public.audit_log
    WHERE op = 'client.onboarded_bulk' AND target_id = ${clientId}
    ORDER BY id DESC LIMIT 1
  `) as { op: string; detail: unknown }[];
  console.log(`   roles: ${roleCount[0]!.c} (expect 3)`);
  console.log(`   levels: ${levelCount[0]!.c} (expect 3)`);
  console.log(`   cardinality_rules: ${cardCount[0]!.c} (expect 3)`);
  console.log(`   user_nodes: ${nodeCount[0]!.c} (expect 6)`);
  console.log(`   credentials: ${credCount[0]!.c} (expect 6)`);
  console.log(`   audit row: ${auditRow.length ? '✓ ' + JSON.stringify(auditRow[0]!.detail) : '✗ MISSING'}`);
  console.log();

  console.log('6. Sample credential output');
  for (const c of (body.credentials as { display_name: string; email: string; temp_password: string }[]).slice(0, 3)) {
    console.log(`   ${c.display_name} <${c.email}> → ${c.temp_password}`);
  }
  console.log();

  console.log('7. Clean up — delete test client');
  await sql`DELETE FROM public.clients WHERE id = ${clientId}::uuid`;
  console.log('   ✓ deleted\n');

  console.log('━━━ ✓ Full pipeline works ━━━');
}

void main();

#!/usr/bin/env tsx
// Seed HR demo data for papa-s-saloon so every HR feature has content:
//  - enables the 'hr' product,
//  - one onboarding template,
//  - one in-progress onboarding instance (partial progress),
//  - one COMPLETED offboarding instance (so the dashboard shows an exit).
// Org Chart + headcount read live user_nodes (no duplication).
// Run: npm run seed:hr
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const SLUG = 'papa-s-saloon';

async function main(): Promise<void> {
  const c = (await sql`SELECT id FROM public.clients WHERE slug = ${SLUG} LIMIT 1`) as Array<{ id: string }>;
  if (!c[0]) { console.error(`Client "${SLUG}" not found. Create it first, then re-run.`); process.exit(1); }
  const clientId = c[0].id;

  const admin = (await sql`SELECT id FROM public.admins ORDER BY is_bootstrap DESC LIMIT 1`) as Array<{ id: string }>;
  const adminId = admin[0]?.id ?? null;

  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'hr', ${adminId}) ON CONFLICT (client_id, product_key) DO NOTHING
  `;

  const nodes = (await sql`
    SELECT id, display_name FROM public.user_nodes
    WHERE client_id = ${clientId} ORDER BY level_number NULLS LAST, created_at LIMIT 3
  `) as Array<{ id: string; display_name: string }>;
  if (!nodes[0]) {
    console.log(`Enabled hr for ${SLUG}, but it has no user_nodes yet — skipping instance seed.`);
    return;
  }

  // Idempotent: clear prior demo instances (tagged with the (demo) suffix).
  await sql`DELETE FROM public.hr_checklist_instances WHERE client_id = ${clientId} AND subject_name LIKE '%(demo)'`;
  await sql`DELETE FROM public.hr_checklist_templates WHERE client_id = ${clientId} AND name = 'Standard onboarding (demo)'`;

  const tpl = (await sql`
    INSERT INTO public.hr_checklist_templates (client_id, kind, name, is_default)
    VALUES (${clientId}, 'onboarding', 'Standard onboarding (demo)', true) RETURNING id
  `) as Array<{ id: string }>;
  const tid = tpl[0]!.id;
  const templateItems = ['Send welcome email', 'Create system logins', 'Assign a buddy', 'Set up workstation'];
  for (let i = 0; i < templateItems.length; i++) {
    await sql`INSERT INTO public.hr_checklist_template_items (template_id, position, label) VALUES (${tid}, ${i}, ${templateItems[i]})`;
  }

  // In-progress onboarding for the first node (first two items done).
  const onSubject = nodes[0]!;
  const on = (await sql`
    INSERT INTO public.hr_checklist_instances (client_id, kind, subject_user_node_id, subject_name, template_id)
    VALUES (${clientId}, 'onboarding', ${onSubject.id}, ${`${onSubject.display_name} (demo)`}, ${tid}) RETURNING id
  `) as Array<{ id: string }>;
  const onId = on[0]!.id;
  for (let i = 0; i < templateItems.length; i++) {
    const done = i < 2;
    await sql`
      INSERT INTO public.hr_checklist_instance_items (instance_id, position, label, done, done_at)
      VALUES (${onId}, ${i}, ${templateItems[i]}, ${done}, ${done ? new Date().toISOString() : null}::timestamptz)
    `;
  }

  // A completed offboarding (feeds the dashboard's exits).
  const offSubject = nodes[1] ?? nodes[0]!;
  const off = (await sql`
    INSERT INTO public.hr_checklist_instances (client_id, kind, subject_user_node_id, subject_name, status, completed_at)
    VALUES (${clientId}, 'offboarding', ${offSubject.id}, ${`${offSubject.display_name} (demo)`}, 'completed', now()) RETURNING id
  `) as Array<{ id: string }>;
  const offId = off[0]!.id;
  const offItems: Array<{ label: string; hint: string | null }> = [
    { label: 'Disable account access', hint: 'disable_access' },
    { label: 'Reassign direct reports', hint: 'reassign_subtree' },
    { label: 'Collect equipment', hint: null },
  ];
  for (let i = 0; i < offItems.length; i++) {
    await sql`
      INSERT INTO public.hr_checklist_instance_items (instance_id, position, label, action_hint, done, done_at)
      VALUES (${offId}, ${i}, ${offItems[i]!.label}, ${offItems[i]!.hint}, true, now())
    `;
  }

  console.log(`Seeded HR demo for ${SLUG}: enabled hr, 1 template, 1 in-progress onboarding, 1 completed offboarding.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

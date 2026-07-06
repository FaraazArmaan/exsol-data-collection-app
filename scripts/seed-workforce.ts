// Seed realistic Workforce + Project Service demo data for a workspace.
//   npm run seed:workforce            # papa-s-saloon
//   npm run seed:workforce some-slug  # any client by slug
//
// Idempotent: safe to re-run. Creates weekly shifts on existing booking_resources
// and demo projects (with resource assignments). Enables saloon-booking + workforce
// products if not already enabled. Requires booking_resources to exist (run
// seed-booking first if the resources list is empty).
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run via `npm run seed:workforce`.');
  process.exit(1);
}

const SLUG = process.argv[2] ?? 'papa-s-saloon';
const sql = neon(DATABASE_URL);

const DEMO_PROJECTS = [
  { name: 'Papa\'s Anniversary Shoot', status: 'active' as const },
  { name: 'Corporate Grooming Package — Q3', status: 'quoted' as const },
  { name: 'Wedding Party Prep — Sharma', status: 'done' as const },
];

// Recurring shift patterns: Mon–Fri 9am–5pm for the first resource,
// Tue/Thu/Sat 10am–6pm for the second.
const SHIFT_PATTERN_A = [1, 2, 3, 4, 5].map((d) => ({ weekday: d, start: '09:00', end: '17:00' }));
const SHIFT_PATTERN_B = [2, 4, 6].map((d) => ({ weekday: d, start: '10:00', end: '18:00' }));

async function main(): Promise<void> {
  const clients = (await sql`
    SELECT id, name FROM public.clients WHERE slug = ${SLUG} LIMIT 1
  `) as Array<{ id: string; name: string }>;

  if (!clients[0]) {
    console.error(`No client found with slug '${SLUG}'. Create the workspace first.`);
    process.exit(1);
  }

  const { id: clientId, name: clientName } = clients[0];
  console.log(`Seeding Workforce for "${clientName}" (${clientId})…`);

  // Ensure bootstrap admin exists for enabled_by_admin FK.
  const admins = (await sql`
    SELECT id FROM public.admins ORDER BY is_bootstrap DESC, created_at ASC LIMIT 1
  `) as Array<{ id: string }>;
  const adminId = admins[0]?.id;
  if (!adminId) { console.error('No admin found. Run the main seed first.'); process.exit(1); }

  // Enable saloon-booking + workforce products.
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES
      (${clientId}::uuid, 'saloon-booking', ${adminId}::uuid),
      (${clientId}::uuid, 'workforce',      ${adminId}::uuid)
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
  console.log('  ✓ Products enabled');

  // Load existing booking_resources.
  const resources = (await sql`
    SELECT id, name FROM public.booking_resources
    WHERE bucket_id = ${clientId}::uuid AND active = true
    ORDER BY name ASC
    LIMIT 4
  `) as Array<{ id: string; name: string }>;

  if (!resources.length) {
    console.warn('  ⚠ No active booking_resources found — run seed-booking first for shift data.');
  } else {
    // Assign shifts to the first two resources (idempotent by checking existing).
    const patterns = [SHIFT_PATTERN_A, SHIFT_PATTERN_B];
    for (let i = 0; i < Math.min(resources.length, 2); i++) {
      const resource = resources[i]!;
      const pattern = patterns[i]!;
      for (const { weekday, start, end } of pattern) {
        const existing = (await sql`
          SELECT id FROM public.workforce_shifts
          WHERE client_id = ${clientId}::uuid
            AND resource_id = ${resource.id}::uuid
            AND weekday = ${weekday}
            AND start_time = ${start}::time
          LIMIT 1
        `) as Array<{ id: string }>;
        if (!existing.length) {
          await sql`
            INSERT INTO public.workforce_shifts (client_id, resource_id, weekday, start_time, end_time)
            VALUES (${clientId}::uuid, ${resource.id}::uuid, ${weekday}, ${start}::time, ${end}::time)
          `;
        }
      }
      console.log(`  ✓ Shifts for "${resource.name}" (${pattern.length} days)`);
    }
  }

  // Create demo projects (idempotent by name).
  const projectIds: string[] = [];
  for (const { name, status } of DEMO_PROJECTS) {
    const existing = (await sql`
      SELECT id FROM public.projects WHERE client_id = ${clientId}::uuid AND name = ${name} LIMIT 1
    `) as Array<{ id: string }>;
    if (existing[0]) {
      projectIds.push(existing[0].id);
      console.log(`  · Project "${name}" already exists`);
    } else {
      const rows = (await sql`
        INSERT INTO public.projects (client_id, name, status)
        VALUES (${clientId}::uuid, ${name}, ${status})
        RETURNING id
      `) as Array<{ id: string }>;
      projectIds.push(rows[0]!.id);
      console.log(`  ✓ Created project "${name}" [${status}]`);
    }
  }

  // Assign the first resource to the first active project.
  if (resources[0] && projectIds[0]) {
    await sql`
      INSERT INTO public.project_assignments (project_id, resource_id)
      VALUES (${projectIds[0]}::uuid, ${resources[0].id}::uuid)
      ON CONFLICT DO NOTHING
    `;
    console.log(`  ✓ Assigned "${resources[0].name}" to "${DEMO_PROJECTS[0]!.name}"`);
  }

  // Seed 2–3 timesheet entries for the first resource across the current week.
  if (resources[0]) {
    const firstResource = resources[0];

    // Compute Monday of the current week (local time, ISO date strings).
    const today = new Date();
    const dow = today.getDay(); // 0 = Sun
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon);

    const isoDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };

    const DEMO_ENTRIES = [
      { offset: 0, start: '09:00', end: '13:00', notes: 'Morning session' },
      { offset: 1, start: '10:00', end: '17:00', notes: 'Full day' },
      { offset: 3, start: '08:30', end: '12:30', notes: 'Training prep' },
    ];

    for (const { offset, start, end, notes } of DEMO_ENTRIES) {
      const entryDate = new Date(monday);
      entryDate.setDate(monday.getDate() + offset);
      const dateStr = isoDate(entryDate);

      const existing = (await sql`
        SELECT id FROM public.timesheet_entries
        WHERE client_id = ${clientId}::uuid
          AND resource_id = ${firstResource.id}::uuid
          AND entry_date = ${dateStr}::date
        LIMIT 1
      `) as Array<{ id: string }>;

      if (!existing.length) {
        await sql`
          INSERT INTO public.timesheet_entries
            (client_id, resource_id, entry_date, start_time, end_time, notes)
          VALUES
            (${clientId}::uuid, ${firstResource.id}::uuid, ${dateStr}::date,
             ${start}::time, ${end}::time, ${notes})
        `;
        console.log(`  ✓ Timesheet entry: ${firstResource.name} ${dateStr} ${start}–${end}`);
      } else {
        console.log(`  · Timesheet entry for ${dateStr} already exists`);
      }
    }
  }

  console.log('\nDone. Golden flows:');
  console.log('  1. Workforce → Staff & Schedule → see weekly shift grid per resource');
  console.log('  2. Workforce → Projects → open an active project → assign a resource');
  console.log('  3. Workforce → Timesheets → see entries for the current week');
}

main().catch((e) => { console.error(e); process.exit(1); });

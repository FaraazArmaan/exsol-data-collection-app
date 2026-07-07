// Workforce test helpers — seeds a Client with saloon-booking + workforce Products
// enabled so both the workforce and project-service modules are accessible.
// No teardown (shared dev DB) — each seed uses a fresh client; string literals
// that have a unique constraint are randomized per call to avoid re-run collisions.
import { neon } from '@neondatabase/serverless';
import { seedClientWithProductsEnabled, makeBucketUserRequest, type PosTestCtx } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

export type WorkforceTestCtx = PosTestCtx & { resourceId: string };

async function enableWorkforce(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'saloon-booking', ${ctx.adminId}),
           (${ctx.clientId}, 'workforce',      ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

// Create a booking_resource for this client (required for shifts + assignments).
async function seedResource(ctx: PosTestCtx, name: string): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.booking_resources (bucket_id, name)
    VALUES (${ctx.clientId}::uuid, ${name})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

// Fresh client with booking+workforce enabled and one seeded booking_resource.
export async function seedWorkforceClient(): Promise<WorkforceTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await enableWorkforce(ctx);
  const resourceId = await seedResource(ctx, randName('Resource'));
  return { ...ctx, resourceId };
}

export { makeBucketUserRequest };

// Bare L2 user_node (no credentials) — enough to be an asset-assignment
// target. Reuses the owner node's role via subselect.
export async function seedSecondNode(ctx: PosTestCtx): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.user_nodes
      (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    SELECT client_id, id, 2, role_id, ${randName('Assignee')},
           ${`${randName('assignee')}@exsol.test`.toLowerCase()}, ${ctx.adminId}
    FROM public.user_nodes WHERE id = ${ctx.userNodeId}::uuid
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

export function randName(prefix = 'WF'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// Seed a project (returns id).
export async function seedProject(
  ctx: PosTestCtx,
  name = randName('Project'),
  status = 'quoted',
): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.projects (client_id, name, status)
    VALUES (${ctx.clientId}::uuid, ${name}, ${status})
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

// Seed a timesheet entry (returns id). Optionally pre-approve by passing approvedBy user_node_id.
export async function seedTimesheetEntry(
  ctx: PosTestCtx,
  resourceId: string,
  opts: { entryDate?: string; startTime?: string; endTime?: string; approvedBy?: string } = {},
): Promise<string> {
  const entryDate = opts.entryDate ?? '2026-01-15';
  const startTime = opts.startTime ?? '09:00';
  const endTime = opts.endTime ?? '17:00';
  const approvedBy = opts.approvedBy ?? null;
  if (approvedBy) {
    const rows = (await sql`
      INSERT INTO public.timesheet_entries
        (client_id, resource_id, entry_date, start_time, end_time, approved_by, approved_at)
      VALUES (
        ${ctx.clientId}::uuid, ${resourceId}::uuid, ${entryDate}::date,
        ${startTime}::time, ${endTime}::time, ${approvedBy}::uuid, now()
      )
      RETURNING id
    `) as Array<{ id: string }>;
    return rows[0]!.id;
  }
  const rows = (await sql`
    INSERT INTO public.timesheet_entries
      (client_id, resource_id, entry_date, start_time, end_time)
    VALUES (
      ${ctx.clientId}::uuid, ${resourceId}::uuid, ${entryDate}::date,
      ${startTime}::time, ${endTime}::time
    )
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

// Seed a shift (returns id).
export async function seedShift(
  ctx: PosTestCtx,
  resourceId: string,
  weekday = 1,
  startTime = '09:00',
  endTime = '17:00',
): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.workforce_shifts (client_id, resource_id, weekday, start_time, end_time)
    VALUES (${ctx.clientId}::uuid, ${resourceId}::uuid, ${weekday}, ${startTime}::time, ${endTime}::time)
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

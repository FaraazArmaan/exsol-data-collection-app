// Integration-test helpers for the Booking module.
//
// Phase 1 only needs a Client + an L1 owner user_node (for bookings.user_node_id
// FK) + a booking_resources row. No module-enable / JWT here — Phase 1 ships no
// auth-gated endpoints. Seed shape mirrors tests/pos/_helpers.ts exactly.
//
// ⚠️ Requires DATABASE_URL pointing at a DB with migrations 043–044 applied.
//    Those are unapplied pending migration-number coordination (see memory
//    project_booking_migration_number_coordination) — run only once settled.

import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../../netlify/functions/_shared/argon';

const sql = neon(process.env.DATABASE_URL!);
export function sqlClient() { return sql; }

let cachedAdminId: string | null = null;

async function ensureBootstrapAdmin(): Promise<string> {
  if (cachedAdminId) return cachedAdminId;
  const found = (await sql`
    SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1
  `) as Array<{ id: string }>;
  if (found[0]) {
    cachedAdminId = found[0].id;
    return cachedAdminId;
  }
  const hash = await hashPassword('booking-test-admin-pw');
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES ('booking-test-admin@exsol.test', ${hash}, 'Booking Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}
    RETURNING id
  `) as Array<{ id: string }>;
  cachedAdminId = rows[0]!.id;
  return cachedAdminId;
}

export interface BookingTestCtx {
  clientId: string;
  ownerNodeId: string;
  adminId: string;
}

export async function seedClientWithBooking(): Promise<BookingTestCtx> {
  const adminId = await ensureBootstrapAdmin();

  const slug = `book-test-${Math.random().toString(36).slice(2, 10)}`;
  const clientRows = (await sql`
    INSERT INTO public.clients (slug, name, created_by)
    VALUES (${slug}, 'Booking Test', ${adminId})
    RETURNING id
  `) as Array<{ id: string }>;
  const clientId = clientRows[0]!.id;

  const roleRows = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}, 'owner', 'Owner', '#3b82f6')
    RETURNING id
  `) as Array<{ id: string }>;
  const roleId = roleRows[0]!.id;

  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, permissions)
    VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)
  `;

  const email = `book-test-owner-${slug}@exsol.test`;
  const nodeRows = (await sql`
    INSERT INTO public.user_nodes
      (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientId}, NULL, 1, ${roleId}, 'Booking Test Owner', ${email}, ${adminId})
    RETURNING id
  `) as Array<{ id: string }>;

  return { clientId, ownerNodeId: nodeRows[0]!.id, adminId };
}

export async function seedResource(clientId: string, name = 'Sarah'): Promise<string> {
  const r = (await sql`
    INSERT INTO public.booking_resources (bucket_id, name) VALUES (${clientId}, ${name}) RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}

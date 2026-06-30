// Integration-test helpers for the Booking module.
//
// seedClientWithBooking() mints a fresh Client + L1 Owner (+ credential + JWT cookie)
// so vendor endpoints can authenticate. Seed shape mirrors tests/pos/_helpers.ts.
// A node's data-bucket = its role's bucket_family (client_roles, mig 022); customer
// nodes need a bucket_family='customers' role (seedCustomerRole).
//
// Requires DATABASE_URL with migrations 043–045 applied (done on dev 2026-06-30).

import { neon } from '@neondatabase/serverless';
import { mintBucketUserSession } from '../../netlify/functions/_shared/session';
import { hashPassword } from '../../netlify/functions/_shared/argon';

const sql = neon(process.env.DATABASE_URL!);
export function sqlClient() { return sql; }

let cachedAdminId: string | null = null;
async function ensureBootstrapAdmin(): Promise<string> {
  if (cachedAdminId) return cachedAdminId;
  const found = (await sql`SELECT id FROM public.admins WHERE is_bootstrap = true LIMIT 1`) as Array<{ id: string }>;
  if (found[0]) { cachedAdminId = found[0].id; return cachedAdminId; }
  const hash = await hashPassword('booking-test-admin-pw');
  const rows = (await sql`
    INSERT INTO public.admins (email, password_hash, display_name, is_bootstrap)
    VALUES ('booking-test-admin@exsol.test', ${hash}, 'Booking Test Admin', false)
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash} RETURNING id
  `) as Array<{ id: string }>;
  cachedAdminId = rows[0]!.id;
  return cachedAdminId;
}

export interface BookingTestCtx {
  clientId: string;
  ownerNodeId: string;
  adminId: string;
  slug: string;
  cookie: string;
}

export async function seedClientWithBooking(): Promise<BookingTestCtx> {
  const adminId = await ensureBootstrapAdmin();
  const slug = `book-test-${Math.random().toString(36).slice(2, 10)}`;
  const c = (await sql`
    INSERT INTO public.clients (slug, name, created_by) VALUES (${slug}, 'Booking Test', ${adminId}) RETURNING id
  `) as Array<{ id: string }>;
  const clientId = c[0]!.id;

  const role = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color)
    VALUES (${clientId}, 'owner', 'Owner', '#3b82f6') RETURNING id
  `) as Array<{ id: string }>;
  await sql`INSERT INTO public.client_levels (client_id, level_number, label, permissions)
            VALUES (${clientId}, 1, 'Primary', '{}'::jsonb)`;

  const email = `book-owner-${slug}@exsol.test`;
  const node = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${clientId}, NULL, 1, ${role[0]!.id}, 'Booking Test Owner', ${email}, ${adminId}) RETURNING id
  `) as Array<{ id: string }>;
  const ownerNodeId = node[0]!.id;

  const hash = await hashPassword('book-owner-pw');
  await sql`
    INSERT INTO public.user_node_credentials
      (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
    VALUES (${clientId}, ${ownerNodeId}, ${email}, ${hash}, false, ${adminId})
  `;

  const token = await mintBucketUserSession({ sub: ownerNodeId, email, client_id: clientId });
  return { clientId, ownerNodeId, adminId, slug, cookie: `bu_session=${token}` };
}

/** Enable the booking module for a client (via the saloon-booking product). */
export async function enableBooking(clientId: string): Promise<void> {
  const adminId = await ensureBootstrapAdmin();
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'saloon-booking', ${adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

export async function grantBookingPerms(
  clientId: string, levelNumber: number, keys: readonly string[],
): Promise<void> {
  const perms: Record<string, true> = Object.fromEntries(keys.map((k) => [k, true]));
  await sql`UPDATE public.client_levels SET permissions = ${JSON.stringify(perms)}::jsonb
            WHERE client_id = ${clientId} AND level_number = ${levelNumber}`;
}

export async function seedResource(clientId: string, name = 'Sarah'): Promise<string> {
  const r = (await sql`INSERT INTO public.booking_resources (bucket_id, name) VALUES (${clientId}, ${name}) RETURNING id`) as Array<{ id: string }>;
  return r[0]!.id;
}

/** Customer-bucket role so the public-create upsert can attach guest nodes. */
export async function seedCustomerRole(clientId: string): Promise<string> {
  const r = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color, bucket_family)
    VALUES (${clientId}, 'customer', 'Customer', '#10b981', 'customers') RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}

export interface SeedServiceInput {
  name?: string; duration_min?: number; price_cents?: number;
  payment_mode?: 'pay_at_venue' | 'deposit' | 'full_upfront';
  deposit_cents?: number; buffer_min?: number; eligible_resource_ids?: string[];
}
export async function makeService(clientId: string, opts: SeedServiceInput = {}): Promise<string> {
  const r = (await sql`
    INSERT INTO public.booking_services
      (bucket_id, name, duration_min, price_cents, payment_mode, deposit_cents, buffer_min, eligible_resource_ids)
    VALUES (${clientId}, ${opts.name ?? 'Color'}, ${opts.duration_min ?? 60}, ${opts.price_cents ?? 50000},
            ${opts.payment_mode ?? 'pay_at_venue'}::booking_payment_mode, ${opts.deposit_cents ?? null},
            ${opts.buffer_min ?? 0}, ${(opts.eligible_resource_ids ?? []) as string[]}::uuid[])
    RETURNING id
  `) as Array<{ id: string }>;
  return r[0]!.id;
}

/** Set the tenant's weekly schedule + interval (so availability has open windows). */
export async function setBookingSettings(
  clientId: string, weekly: Record<string, Array<{ open: string; close: string }>>,
  opts: { slot_interval_min?: number; lead_time_min?: number; cancel_cutoff_min?: number } = {},
): Promise<void> {
  await sql`
    INSERT INTO public.booking_settings
      (bucket_id, slot_interval_min, lead_time_min, cancel_cutoff_min, weekly_schedule, date_overrides)
    VALUES (${clientId}, ${opts.slot_interval_min ?? 30}, ${opts.lead_time_min ?? 0},
            ${opts.cancel_cutoff_min ?? 0}, ${JSON.stringify(weekly)}::jsonb, '[]'::jsonb)
    ON CONFLICT (bucket_id) DO UPDATE SET
      slot_interval_min = EXCLUDED.slot_interval_min, lead_time_min = EXCLUDED.lead_time_min,
      cancel_cutoff_min = EXCLUDED.cancel_cutoff_min, weekly_schedule = EXCLUDED.weekly_schedule
  `;
}

/** Vendor (authed) request with the owner's JWT cookie. */
export function bookingRequest(ctx: BookingTestCtx, method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { cookie: ctx.cookie, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Public (anonymous) request to /api/booking-public/:slug/<suffix>. */
export function publicRequest(slug: string, method: string, suffix: string, body?: unknown): Request {
  const path = `/api/booking-public/${slug}${suffix.startsWith('/') ? suffix : '/' + suffix}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

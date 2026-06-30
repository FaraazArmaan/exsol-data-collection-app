import type { NeonQueryFunction } from '@neondatabase/serverless';
import { normalizePhone } from '../../src/modules/booking/lib/dedupe';

// Resolve a customers-bucket role for the tenant, creating a default one on demand.
// Booking attaches every guest to a `bucket_family='customers'` role; rather than
// require onboarding to pre-seed it, we lazy-create a "Customer" role the first time
// a guest books. Self-healing for existing tenants. Concurrent first-bookings race on
// client_roles_key_per_client_unique → ON CONFLICT DO NOTHING + re-select settles it.
async function ensureCustomerRole(sql: NeonQueryFunction<false, false>, clientId: string): Promise<string> {
  const existing = (await sql`
    SELECT id FROM public.client_roles WHERE client_id = ${clientId}::uuid AND bucket_family = 'customers' LIMIT 1
  `) as Array<{ id: string }>;
  if (existing[0]) return existing[0].id;

  const created = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color, bucket_family)
    VALUES (${clientId}::uuid, 'customer', 'Customer', '#10b981', 'customers')
    ON CONFLICT (client_id, key) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;
  if (created[0]) return created[0].id;

  // 'customer' key existed (race, or a non-customers role used that key). Prefer any
  // customers-bucket role; else mint one under a distinct key.
  const after = (await sql`
    SELECT id FROM public.client_roles WHERE client_id = ${clientId}::uuid AND bucket_family = 'customers' LIMIT 1
  `) as Array<{ id: string }>;
  if (after[0]) return after[0].id;
  const alt = (await sql`
    INSERT INTO public.client_roles (client_id, key, label, color, bucket_family)
    VALUES (${clientId}::uuid, 'booking-customers', 'Booking Customers', '#10b981', 'customers')
    RETURNING id
  `) as Array<{ id: string }>;
  return alt[0]!.id;
}

// Match-or-create a customer user_node. Match priority: an existing customers-bucket
// node (role.bucket_family='customers') with the same lower(email) OR normalized phone.
export async function upsertCustomer(
  sql: NeonQueryFunction<false, false>,
  clientId: string,
  customer: { name: string; phone: string; email?: string | null },
): Promise<{ userNodeId: string; wasCreated: boolean }> {
  const phone = normalizePhone(customer.phone);
  const email = customer.email?.trim().toLowerCase() ?? null;

  const existing = (await sql`
    SELECT un.id FROM public.user_nodes un
    JOIN public.client_roles cr ON cr.id = un.role_id
    WHERE un.client_id = ${clientId}::uuid AND cr.bucket_family = 'customers'
      AND ((${email}::text IS NOT NULL AND lower(un.email::text) = ${email})
        OR (${phone}::text IS NOT NULL AND un.phone = ${phone}))
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing[0]) return { userNodeId: existing[0].id, wasCreated: false };

  const roleId = await ensureCustomerRole(sql, clientId);

  const created = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, phone)
    VALUES (${clientId}::uuid, NULL, NULL, ${roleId}::uuid, ${customer.name}, ${email}, ${phone})
    RETURNING id
  `) as Array<{ id: string }>;
  return { userNodeId: created[0]!.id, wasCreated: true };
}

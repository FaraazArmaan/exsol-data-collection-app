import type { NeonQueryFunction } from '@neondatabase/serverless';
import { normalizePhone } from '../../src/modules/booking/lib/dedupe';

// Match-or-create a customer user_node. Match priority: an existing customers-bucket
// node (role.bucket_family='customers') with the same lower(email) OR normalized phone.
// Requires the tenant to have a customers-bucket role (booking can't attach guests otherwise).
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

  const role = (await sql`
    SELECT id FROM public.client_roles
    WHERE client_id = ${clientId}::uuid AND bucket_family = 'customers' LIMIT 1
  `) as Array<{ id: string }>;
  if (!role[0]) throw new Error('no_customer_role');

  const created = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, phone)
    VALUES (${clientId}::uuid, NULL, NULL, ${role[0].id}::uuid, ${customer.name}, ${email}, ${phone})
    RETURNING id
  `) as Array<{ id: string }>;
  return { userNodeId: created[0]!.id, wasCreated: true };
}

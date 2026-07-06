import type { NeonQueryFunction } from '@neondatabase/serverless';
import { mergeCustomers, type RawCustomerRow } from './merge';

type Sql = NeonQueryFunction<false, false>;

/**
 * Materialize crm_customers for one client from user_nodes(customers) + paid sales,
 * deduped by mergeCustomers. Idempotent (ON CONFLICT upsert). Returns rows upserted.
 * Accepts any Neon sql client (db() in functions, neon(url) in scripts).
 */
export async function refreshCustomers(sql: Sql, clientId: string): Promise<number> {
  const bookingRows = (await sql`
    SELECT un.display_name AS display_name, un.phone AS phone, un.email::text AS email,
           'booking'::text AS source,
           COALESCE(min(b.created_at), un.created_at) AS first_seen,
           COALESCE(max(b.created_at), un.created_at) AS last_seen
    FROM public.user_nodes un
    JOIN public.client_roles cr ON cr.id = un.role_id AND cr.bucket_family = 'customers'
    LEFT JOIN public.bookings b ON b.user_node_id = un.id
    WHERE un.client_id = ${clientId}::uuid
    GROUP BY un.id, un.display_name, un.phone, un.email, un.created_at
  `) as RawCustomerRow[];

  const saleRows = (await sql`
    SELECT s.customer_name AS display_name, s.customer_phone AS phone, s.customer_email AS email,
           CASE WHEN s.source = 'storefront' THEN 'storefront' ELSE 'pos' END AS source,
           min(s.created_at) AS first_seen, max(s.created_at) AS last_seen
    FROM public.sales s
    WHERE s.bucket_id = ${clientId}::uuid AND s.status IN ('paid', 'fulfilled')
    GROUP BY s.customer_name, s.customer_phone, s.customer_email,
             (CASE WHEN s.source = 'storefront' THEN 'storefront' ELSE 'pos' END)
  `) as RawCustomerRow[];

  const merged = mergeCustomers([...bookingRows, ...saleRows]);
  for (const c of merged) {
    await sql`
      INSERT INTO public.crm_customers
        (client_id, display_name, phone, email, dedupe_key, source, first_seen, last_seen)
      VALUES (${clientId}::uuid, ${c.display_name}, ${c.phone}, ${c.email}, ${c.dedupe_key}, ${c.source}, ${c.first_seen}, ${c.last_seen})
      ON CONFLICT (client_id, dedupe_key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        last_seen = GREATEST(public.crm_customers.last_seen, EXCLUDED.last_seen),
        first_seen = LEAST(public.crm_customers.first_seen, EXCLUDED.first_seen),
        updated_at = now()
    `;
  }
  return merged.length;
}

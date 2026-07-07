// Public (unauthenticated) CRM tenant resolution + lead→customer conversion.
// Mirrors _pub-authz.resolveStorefront: read the client by slug, confirm the CRM
// module is reachable via an enabled product. Returns null on any failure (no
// reason leaked to anonymous callers).
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { db } from './_shared/db';
import { getProduct } from '@registry/products';
import { normalizePhone } from '../../src/lib/customer-dedupe';

type SQL = NeonQueryFunction<false, false>;

export interface CrmTenant { clientId: string; name: string; }

export async function resolveCrmTenant(slug: string): Promise<CrmTenant | null> {
  if (!slug) return null;
  const sql = db();
  const rows = (await sql`SELECT id, name FROM public.clients WHERE slug = ${slug} LIMIT 1`) as Array<{ id: string; name: string }>;
  const c = rows[0];
  if (!c) return null;
  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${c.id}::uuid
  `) as Array<{ product_key: string }>;
  const modules = new Set<string>();
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product) for (const ref of product.modules) modules.add(ref.module);
  }
  if (!modules.has('crm')) return null;
  return { clientId: c.id, name: c.name };
}

/**
 * Materialize a crm_customer from a lead's contact info, deduped on the same
 * key the read-model uses (phone:<normalized> | email:<lower>). Upserts so a
 * lead for an existing customer merges rather than duplicating. Returns the
 * customer id (or null if the lead has no usable contact — shouldn't happen
 * given the crm_leads CHECK). Lead-sourced customers get source='storefront'.
 */
export async function upsertCustomerFromLead(
  sql: SQL,
  clientId: string,
  lead: { name: string; email: string | null; phone: string | null },
): Promise<string | null> {
  const phone = normalizePhone(lead.phone ?? '');
  const email = lead.email ? lead.email.trim().toLowerCase() : null;
  const dedupeKey = phone ? `phone:${phone}` : email ? `email:${email}` : null;
  if (!dedupeKey) return null;
  const name = lead.name.trim() || 'Unknown';

  const rows = (await sql`
    INSERT INTO public.crm_customers (client_id, display_name, phone, email, dedupe_key, source, first_seen, last_seen)
    VALUES (${clientId}::uuid, ${name}, ${phone}, ${email}, ${dedupeKey}, 'storefront', now(), now())
    ON CONFLICT (client_id, dedupe_key) DO UPDATE
      SET last_seen = now(),
          updated_at = now(),
          display_name = CASE WHEN public.crm_customers.display_name = 'Unknown'
                              THEN EXCLUDED.display_name ELSE public.crm_customers.display_name END,
          phone = COALESCE(public.crm_customers.phone, EXCLUDED.phone),
          email = COALESCE(public.crm_customers.email, EXCLUDED.email)
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;
export type Audience = 'all' | 'recent_30d';

export async function audienceRecipients(sql: Sql, clientId: string, audience: Audience): Promise<{ id: string; email: string }[]> {
  const rows = audience === 'recent_30d'
    ? await sql`SELECT id, email FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL AND last_seen >= now() - interval '30 days'`
    : await sql`SELECT id, email FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL`;
  return rows as { id: string; email: string }[];
}

export async function audienceCount(sql: Sql, clientId: string, audience: Audience): Promise<number> {
  const rows = audience === 'recent_30d'
    ? await sql`SELECT count(*)::int AS n FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL AND last_seen >= now() - interval '30 days'`
    : await sql`SELECT count(*)::int AS n FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL`;
  return (rows as { n: number }[])[0]?.n ?? 0;
}

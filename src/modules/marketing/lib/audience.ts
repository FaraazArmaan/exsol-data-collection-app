import type { NeonQueryFunction } from '@neondatabase/serverless';
import { channelContact, type Channel } from './channels';

type Sql = NeonQueryFunction<false, false>;
export type Audience = 'all' | 'recent_30d';

export interface Recipient {
  id: string;
  email: string | null;
  phone: string | null;
}

// All audience members (regardless of contactability) for a client. The channel
// then decides who is reachable (see reachableRecipients).
async function audienceRows(sql: Sql, clientId: string, audience: Audience): Promise<Recipient[]> {
  const rows = audience === 'recent_30d'
    ? await sql`SELECT id, email, phone FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND last_seen >= now() - interval '30 days'`
    : await sql`SELECT id, email, phone FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid`;
  return rows as Recipient[];
}

/**
 * Email-only recipients — the v1 contract, preserved so existing callers/tests
 * are unaffected. Equivalent to reachableRecipients(..., 'email') projected to
 * {id,email}.
 */
export async function audienceRecipients(sql: Sql, clientId: string, audience: Audience): Promise<{ id: string; email: string }[]> {
  const rows = await audienceRows(sql, clientId, audience);
  return rows.filter((r) => r.email).map((r) => ({ id: r.id, email: r.email as string }));
}

/**
 * Recipients reachable on a given channel: email→has email, sms/whatsapp→has
 * phone. Unreachable members are dropped (mirrors v1 skipping email-less rows).
 */
export async function reachableRecipients(sql: Sql, clientId: string, audience: Audience, channel: Channel): Promise<Recipient[]> {
  const rows = await audienceRows(sql, clientId, audience);
  const need = channelContact(channel);
  if (need === 'email') return rows.filter((r) => r.email);
  if (need === 'phone') return rows.filter((r) => r.phone);
  return rows;
}

export async function audienceCount(sql: Sql, clientId: string, audience: Audience): Promise<number> {
  const rows = audience === 'recent_30d'
    ? await sql`SELECT count(*)::int AS n FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL AND last_seen >= now() - interval '30 days'`
    : await sql`SELECT count(*)::int AS n FROM public.crm_customers
                WHERE client_id = ${clientId}::uuid AND email IS NOT NULL`;
  return (rows as { n: number }[])[0]?.n ?? 0;
}

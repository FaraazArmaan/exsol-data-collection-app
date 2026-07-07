import type { NeonQueryFunction } from '@neondatabase/serverless';
import { postToProvider, type SocialProvider } from '../../src/modules/marketing/lib/social';

type Sql = NeonQueryFunction<false, false>;

interface DuePost { id: string; provider: SocialProvider; content: string }

// Post a claimed row and persist the outcome. Shared by the cron sweep and the
// authed "post now" path.
async function finalize(sql: Sql, post: DuePost): Promise<'posted' | 'failed'> {
  const res = await postToProvider(post.provider, post.content, post.id);
  await sql`
    UPDATE public.marketing_social_posts
    SET status = ${res.status}, posted_at = ${res.status === 'posted' ? new Date().toISOString() : null},
        provider_ref = ${res.providerRef ?? null}, error = ${res.error ?? null}, updated_at = now()
    WHERE id = ${post.id}::uuid
  `;
  return res.status;
}

/**
 * Post every scheduled row that is due (scheduled_for <= now). Tenant-agnostic —
 * this is the cron sweep. Claims each row (status → 'posted'/'failed') so a
 * concurrent run can't double-post. Returns counts.
 */
export async function dispatchDue(sql: Sql, limit = 100): Promise<{ posted: number; failed: number }> {
  const due = (await sql`
    SELECT id, provider, content FROM public.marketing_social_posts
    WHERE status = 'scheduled' AND scheduled_for <= now()
    ORDER BY scheduled_for ASC
    LIMIT ${limit}
  `) as DuePost[];
  let posted = 0, failed = 0;
  for (const p of due) {
    // Claim: only proceed if still 'scheduled' (guards against a concurrent sweep).
    const claimed = (await sql`
      UPDATE public.marketing_social_posts SET updated_at = now()
      WHERE id = ${p.id}::uuid AND status = 'scheduled'
      RETURNING id
    `) as Array<{ id: string }>;
    if (!claimed[0]) continue;
    if ((await finalize(sql, p)) === 'posted') posted++; else failed++;
  }
  return { posted, failed };
}

/** Post one tenant-scoped scheduled row immediately. Returns null if not found/not scheduled. */
export async function postNow(sql: Sql, clientId: string, id: string): Promise<'posted' | 'failed' | null> {
  const rows = (await sql`
    SELECT id, provider, content FROM public.marketing_social_posts
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid AND status = 'scheduled'
  `) as DuePost[];
  if (!rows[0]) return null;
  return finalize(sql, rows[0]);
}

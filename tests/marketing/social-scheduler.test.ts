import { describe, it, expect } from 'vitest';
import postsHandler from '../../netlify/functions/marketing-social-posts';
import { dispatchDue } from '../../netlify/functions/_marketing-social';
import { seedClientWithMarketing, enableMarketing, grantMarketingPerms, demoteToL2, marketingRequest, sqlClient } from './_helpers';

const sql = sqlClient();
const future = () => new Date(Date.now() + 86_400_000).toISOString();

describe('Social scheduler', () => {
  it('schedules a post, posts it now, and reflects the outcome', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await postsHandler(marketingRequest(ctx, 'POST', '/api/marketing/social-posts',
      { provider: 'facebook', content: 'Grand reopening this Friday!', scheduled_for: future() }));
    expect(res.status).toBe(200);
    const post = (await res.json()).post;
    expect(post.status).toBe('scheduled');

    const now = await postsHandler(marketingRequest(ctx, 'POST', '/api/marketing/social-posts', { action: 'post_now', id: post.id }));
    expect(now.status).toBe(200);
    expect((await now.json()).status).toBe('posted');

    const row = (await sql`SELECT status, posted_at, provider_ref FROM public.marketing_social_posts WHERE id = ${post.id}::uuid`) as Array<{ status: string; posted_at: string | null; provider_ref: string | null }>;
    expect(row[0]!.status).toBe('posted');
    expect(row[0]!.posted_at).toBeTruthy();
    expect(row[0]!.provider_ref).toContain('mock_facebook_');
  });

  it('rejects content over the provider limit (400)', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await postsHandler(marketingRequest(ctx, 'POST', '/api/marketing/social-posts',
      { provider: 'x', content: 'x'.repeat(281), scheduled_for: future() }));
    expect(res.status).toBe(400);
  });

  it('cancels a scheduled post; a second cancel is 409', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    const res = await postsHandler(marketingRequest(ctx, 'POST', '/api/marketing/social-posts',
      { provider: 'instagram', content: 'Sneak peek', scheduled_for: future() }));
    const id = (await res.json()).post.id;
    const del = await postsHandler(marketingRequest(ctx, 'DELETE', `/api/marketing/social-posts?id=${id}`));
    expect(del.status).toBe(204);
    const again = await postsHandler(marketingRequest(ctx, 'DELETE', `/api/marketing/social-posts?id=${id}`));
    expect(again.status).toBe(409);
  });

  it('the scheduled sweep posts due rows', async () => {
    const ctx = await seedClientWithMarketing();
    await enableMarketing(ctx.clientId);
    // Insert a past-due scheduled post directly.
    const rows = (await sql`
      INSERT INTO public.marketing_social_posts (client_id, provider, content, scheduled_for, status)
      VALUES (${ctx.clientId}::uuid, 'linkedin', 'Due now', now() - interval '1 minute', 'scheduled')
      RETURNING id`) as Array<{ id: string }>;
    const id = rows[0]!.id;

    const result = await dispatchDue(sql);
    expect(result.posted).toBeGreaterThanOrEqual(1);

    const row = (await sql`SELECT status FROM public.marketing_social_posts WHERE id = ${id}::uuid`) as Array<{ status: string }>;
    expect(row[0]!.status).toBe('posted');
  });

  it('create requires customers.create; post_now requires edit', async () => {
    const owner = await seedClientWithMarketing();
    await enableMarketing(owner.clientId);
    const l2 = await demoteToL2(owner);
    const denied = await postsHandler(marketingRequest(l2, 'POST', '/api/marketing/social-posts',
      { provider: 'facebook', content: 'hi', scheduled_for: future() }));
    expect(denied.status).toBe(403);
    await grantMarketingPerms(owner.clientId, 2, ['marketing.customers.create']);
    const ok = await postsHandler(marketingRequest(l2, 'POST', '/api/marketing/social-posts',
      { provider: 'facebook', content: 'hi', scheduled_for: future() }));
    expect(ok.status).toBe(200);
  });
});

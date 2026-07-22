import { describe, expect, it } from 'vitest';
import { neon } from '@neondatabase/serverless';
import routingHandler from '../../netlify/functions/workforce-approval-routing';
import inboxHandler from '../../netlify/functions/workforce-approval-inbox';
import leaveHandler from '../../netlify/functions/workforce-leave';
import { hashPassword } from '../../netlify/functions/_shared/argon';
import { mintBucketUserSession } from '../../netlify/functions/_shared/session';
import { makeBucketUserRequest, seedSecondNode, seedWorkforceClient } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);

function req(ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, method: string, path: string, body?: unknown) {
  return makeBucketUserRequest(ctx, method, path, body);
}

async function managerRequest(
  ctx: Awaited<ReturnType<typeof seedWorkforceClient>>,
  userNodeId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Request> {
  const rows = await sql`SELECT email FROM public.user_nodes WHERE id = ${userNodeId}::uuid` as Array<{ email: string }>;
  const email = rows[0]!.email;
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, permissions)
    VALUES (${ctx.clientId}::uuid, 2, 'Manager', '{"workforce.leave.edit": true}'::jsonb)
    ON CONFLICT (client_id, level_number) DO UPDATE SET permissions = EXCLUDED.permissions
  `;
  await sql`
    INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
    VALUES (${ctx.clientId}::uuid, ${userNodeId}::uuid, ${email}, ${await hashPassword('approval-test-password')}, false, ${ctx.adminId}::uuid)
    ON CONFLICT (user_node_id) DO NOTHING
  `;
  const token = await mintBucketUserSession({ sub: userNodeId, email, client_id: ctx.clientId });
  return new Request(`http://localhost${path}`, {
    method,
    headers: { cookie: `bu_session=${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('workforce approval routing', () => {
  it('routes pending leave to its policy owner and keeps configuration tenant-scoped', async () => {
    const ctx = await seedWorkforceClient();
    const ownerId = await seedSecondNode(ctx);
    const policy = await routingHandler(req(ctx, 'POST', '/api/workforce/approval-routing', {
      kind: 'policy',
      request_type: 'leave',
      primary_approver_user_node_id: ownerId,
      response_target_hours: 12,
    }));
    expect(policy.status).toBe(200);

    await sql`
      INSERT INTO public.leave_requests (client_id, resource_id, user_node_id, leave_type, start_date, end_date)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, 'annual', '2026-08-01'::date, '2026-08-01'::date)
    `;
    const inbox = await inboxHandler(req(ctx, 'GET', '/api/workforce/approval-inbox'));
    expect(inbox.status).toBe(200);
    const body = await inbox.json() as { items: Array<{ request_type: string; owner_user_node_id: string; response_target_hours: number }> };
    expect(body.items).toEqual(expect.arrayContaining([expect.objectContaining({
      request_type: 'leave', owner_user_node_id: ownerId, response_target_hours: 12,
    })]));

    const other = await seedWorkforceClient();
    const crossTenant = await routingHandler(req(ctx, 'POST', '/api/workforce/approval-routing', {
      kind: 'policy',
      request_type: 'overtime',
      primary_approver_user_node_id: other.userNodeId,
      response_target_hours: 24,
    }));
    expect(crossTenant.status).toBe(400);
    expect((await crossTenant.json()).error.code).toBe('primary_approver_not_in_workspace');
  });

  it('creates and revokes a delegation only for Team users in the workspace', async () => {
    const ctx = await seedWorkforceClient();
    const delegateId = await seedSecondNode(ctx);
    const created = await routingHandler(req(ctx, 'POST', '/api/workforce/approval-routing', {
      kind: 'delegation',
      request_type: 'time_correction',
      owner_user_node_id: ctx.userNodeId,
      delegate_user_node_id: delegateId,
      ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      reason: 'Annual leave cover',
    }));
    expect(created.status).toBe(201);
    const delegation = (await created.json() as { delegation: { id: string } }).delegation;

    const revoked = await routingHandler(req(ctx, 'DELETE', `/api/workforce/approval-routing?delegation_id=${delegation.id}`));
    expect(revoked.status).toBe(204);
    const list = await routingHandler(req(ctx, 'GET', '/api/workforce/approval-routing'));
    const body = await list.json() as { delegations: Array<{ id: string; revoked_at: string | null }> };
    expect(body.delegations).toEqual(expect.arrayContaining([expect.objectContaining({ id: delegation.id, revoked_at: expect.any(String) })]));
  });

  it('blocks a permitted manager until the owner delegates that request type', async () => {
    const ctx = await seedWorkforceClient();
    const managerId = await seedSecondNode(ctx);
    const policy = await routingHandler(req(ctx, 'POST', '/api/workforce/approval-routing', {
      kind: 'policy', request_type: 'leave', primary_approver_user_node_id: ctx.userNodeId, response_target_hours: 24,
    }));
    expect(policy.status).toBe(200);
    const leaveRows = await sql`
      INSERT INTO public.leave_requests (client_id, resource_id, user_node_id, leave_type, start_date, end_date)
      VALUES (${ctx.clientId}::uuid, ${ctx.resourceId}::uuid, ${ctx.userNodeId}::uuid, 'annual', '2026-08-02'::date, '2026-08-02'::date)
      RETURNING id
    ` as Array<{ id: string }>;
    const leaveId = leaveRows[0]!.id;
    const denied = await leaveHandler(await managerRequest(ctx, managerId, 'PATCH', `/api/workforce/leave/${leaveId}`, { action: 'approve' }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('approval_not_assigned_to_actor');

    const delegation = await routingHandler(req(ctx, 'POST', '/api/workforce/approval-routing', {
      kind: 'delegation', request_type: 'leave', owner_user_node_id: ctx.userNodeId, delegate_user_node_id: managerId,
      ends_at: new Date(Date.now() + 86_400_000).toISOString(), reason: 'Approved manager cover',
    }));
    expect(delegation.status).toBe(201);
    const approved = await leaveHandler(await managerRequest(ctx, managerId, 'PATCH', `/api/workforce/leave/${leaveId}`, { action: 'approve' }));
    expect(approved.status).toBe(200);
  });
});

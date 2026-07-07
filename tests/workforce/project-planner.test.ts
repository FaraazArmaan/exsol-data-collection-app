import { describe, it, expect, beforeAll } from 'vitest';
import planHandler from '../../netlify/functions/workforce-project-plan';
import applyHandler from '../../netlify/functions/workforce-project-plan-apply';
import { seedWorkforceClient, makeBucketUserRequest, seedProject, randName } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
beforeAll(async () => { ctx = await seedWorkforceClient(); });

const generate = (body: unknown) =>
  planHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/project-plan', body));
const listPlans = (projectId: string) =>
  planHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/project-plan?project_id=${projectId}`));
const apply = (body: unknown) =>
  applyHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/project-plan-apply', body));

describe('ai project planner', () => {
  it('POST generates a plan and returns draft tasks', async () => {
    const projId = await seedProject(ctx, randName('AIPlan'));
    const res = await generate({ project_id: projId, description: 'Build a website with landing page and contact form' });
    expect(res.status).toBe(201);
    const data = await res.json() as { plan: { id: string; draft_tasks: unknown[] } };
    expect(data.plan.id).toBeTruthy();
    expect(Array.isArray(data.plan.draft_tasks)).toBe(true);
    expect(data.plan.draft_tasks.length).toBeGreaterThan(0);
  });

  it('GET lists saved plans', async () => {
    const projId = await seedProject(ctx, randName('AIList'));
    await generate({ project_id: projId, description: 'Test description' });
    const res = await listPlans(projId);
    expect(res.status).toBe(200);
    const data = await res.json() as { plans: unknown[] };
    expect(data.plans.length).toBeGreaterThan(0);
  });

  it('POST apply converts draft tasks to real tasks', async () => {
    const projId = await seedProject(ctx, randName('AIApply'));
    const genRes = await generate({ project_id: projId, description: 'Launch marketing campaign' });
    const { plan } = await genRes.json() as { plan: { id: string; draft_tasks: unknown[] } };
    const count = plan.draft_tasks.length;

    const applyRes = await apply({ plan_id: plan.id });
    expect(applyRes.status).toBe(200);
    const data = await applyRes.json() as { applied: number };
    expect(data.applied).toBe(count);
  });

  it('POST 400 when description missing', async () => {
    const projId = await seedProject(ctx, randName('AIBad'));
    const res = await generate({ project_id: projId, description: '' });
    expect(res.status).toBe(400);
  });

  it('POST apply 404 for unknown plan', async () => {
    const res = await apply({ plan_id: '00000000-0000-0000-0000-000000000001' });
    expect(res.status).toBe(404);
  });

  it('POST 401 without auth', async () => {
    const res = await planHandler(new Request('http://localhost/api/workforce/project-plan', { method: 'POST' }));
    expect(res.status).toBe(401);
  });
});

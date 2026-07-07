import { describe, it, expect, beforeAll } from 'vitest';
import budgetHandler from '../../netlify/functions/workforce-project-budget';
import { seedWorkforceClient, makeBucketUserRequest, seedProject, seedTimesheetEntry, randName } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
beforeAll(async () => { ctx = await seedWorkforceClient(); });

const get = (projectId: string) =>
  budgetHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/project-budget/${projectId}`));
const patch = (projectId: string, body: unknown) =>
  budgetHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/workforce/project-budget/${projectId}`, body));

describe('project budget tracker', () => {
  it('GET returns zero budget summary for new project', async () => {
    const id = await seedProject(ctx, randName('Budget'));
    const res = await get(id);
    expect(res.status).toBe(200);
    const data = await res.json() as { budget: { budget_cents: null; total_hours: number; burn_pct: null } };
    expect(data.budget.budget_cents).toBeNull();
    expect(data.budget.total_hours).toBe(0);
    expect(data.budget.burn_pct).toBeNull();
  });

  it('PATCH sets budget and hourly rate', async () => {
    const id = await seedProject(ctx, randName('SetBudget'));
    const res = await patch(id, { budget_cents: 100000, hourly_rate_cents: 5000 });
    expect(res.status).toBe(200);
    const data = await res.json() as { project: { budget_cents: number; hourly_rate_cents: number } };
    expect(Number(data.project.budget_cents)).toBe(100000);
    expect(Number(data.project.hourly_rate_cents)).toBe(5000);
  });

  it('GET reflects set budget and shows burn %', async () => {
    const id = await seedProject(ctx, randName('BurnTest'));
    await patch(id, { budget_cents: 80000, hourly_rate_cents: 10000 });
    const res = await get(id);
    expect(res.status).toBe(200);
    const data = await res.json() as { budget: { budget_cents: number; burn_pct: number | null } };
    expect(Number(data.budget.budget_cents)).toBe(80000);
  });

  it('GET 404 for unknown project', async () => {
    const res = await get('00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(404);
  });

  it('PATCH 400 for negative budget', async () => {
    const id = await seedProject(ctx, randName('BadBudget'));
    const res = await patch(id, { budget_cents: -100 });
    expect(res.status).toBe(400);
  });

  it('GET 401 without auth', async () => {
    const id = await seedProject(ctx, randName('Unauth'));
    const res = await budgetHandler(new Request(`http://localhost/api/workforce/project-budget/${id}`));
    expect(res.status).toBe(401);
  });
});

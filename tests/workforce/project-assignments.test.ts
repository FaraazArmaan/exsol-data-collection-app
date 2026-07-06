import { describe, it, expect } from 'vitest';
import assignmentsHandler from '../../netlify/functions/workforce-project-assignments';
import projectHandler from '../../netlify/functions/workforce-project';
import { seedWorkforceClient, makeBucketUserRequest, seedProject, randName } from './_helpers';

const assign = (
  ctx: Awaited<ReturnType<typeof seedWorkforceClient>>,
  projectId: string,
  resourceId: string,
) =>
  assignmentsHandler(
    makeBucketUserRequest(ctx, 'POST', '/api/workforce/project-assignments', { project_id: projectId, resource_id: resourceId }),
  );

const unassign = (
  ctx: Awaited<ReturnType<typeof seedWorkforceClient>>,
  projectId: string,
  resourceId: string,
) =>
  assignmentsHandler(
    makeBucketUserRequest(ctx, 'DELETE', '/api/workforce/project-assignments', { project_id: projectId, resource_id: resourceId }),
  );

const detail = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, id: string) =>
  projectHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/project/${id}`));

describe('workforce project-assignments', () => {
  it('assigns a resource and it appears in project detail', async () => {
    const ctx = await seedWorkforceClient();
    const projectId = await seedProject(ctx, randName('AssignProj'));
    const res = await assign(ctx, projectId, ctx.resourceId);
    expect(res.status).toBe(201);

    const d = await (await detail(ctx, projectId)).json() as { assignments: Array<{ resource_id: string }> };
    expect(d.assignments.map((a) => a.resource_id)).toContain(ctx.resourceId);
  });

  it('409 on duplicate assignment', async () => {
    const ctx = await seedWorkforceClient();
    const projectId = await seedProject(ctx, randName('DupProj'));
    await assign(ctx, projectId, ctx.resourceId);
    const res = await assign(ctx, projectId, ctx.resourceId);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('already_assigned');
  });

  it('unassigns a resource and it disappears from project detail', async () => {
    const ctx = await seedWorkforceClient();
    const projectId = await seedProject(ctx, randName('UnassignProj'));
    await assign(ctx, projectId, ctx.resourceId);
    const res = await unassign(ctx, projectId, ctx.resourceId);
    expect(res.status).toBe(204);

    const d = await (await detail(ctx, projectId)).json() as { assignments: Array<{ resource_id: string }> };
    expect(d.assignments.map((a) => a.resource_id)).not.toContain(ctx.resourceId);
  });

  it('404 when project belongs to another client', async () => {
    const ctx = await seedWorkforceClient();
    const other = await seedWorkforceClient();
    const projectId = await seedProject(other, randName('ForeignProj'));
    const res = await assign(ctx, projectId, ctx.resourceId);
    expect(res.status).toBe(404);
  });

  it('404 when resource belongs to another client', async () => {
    const ctx = await seedWorkforceClient();
    const other = await seedWorkforceClient();
    const projectId = await seedProject(ctx, randName('ForeignRes'));
    const res = await assign(ctx, projectId, other.resourceId);
    expect(res.status).toBe(404);
  });

  it('400 when project_id missing', async () => {
    const ctx = await seedWorkforceClient();
    const res = await assignmentsHandler(
      makeBucketUserRequest(ctx, 'POST', '/api/workforce/project-assignments', { resource_id: ctx.resourceId }),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('project_id_required');
  });

  it('401 without auth', async () => {
    const res = await assignmentsHandler(new Request('http://localhost/api/workforce/project-assignments', { method: 'POST' }));
    expect(res.status).toBe(401);
  });
});

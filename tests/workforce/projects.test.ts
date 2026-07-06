import { describe, it, expect } from 'vitest';
import projectsHandler from '../../netlify/functions/workforce-projects';
import projectHandler from '../../netlify/functions/workforce-project';
import { seedWorkforceClient, makeBucketUserRequest, seedProject, randName } from './_helpers';

const list = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, qs = '') =>
  projectsHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/projects${qs}`));

const create = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, body: unknown) =>
  projectsHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/projects', body));

const detail = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, id: string) =>
  projectHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/project/${id}`));

const patch = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>, id: string, body: unknown) =>
  projectHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/workforce/project/${id}`, body));

describe('workforce projects', () => {
  it('creates a project in quoted status', async () => {
    const ctx = await seedWorkforceClient();
    const name = randName('Proj');
    const res = await create(ctx, { name });
    expect(res.status).toBe(201);
    const body = await res.json() as { project: { id: string; name: string; status: string } };
    expect(body.project.name).toBe(name);
    expect(body.project.status).toBe('quoted');
  });

  it('lists projects', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedProject(ctx, randName('ListTest'));
    const res = await list(ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { projects: Array<{ id: string }> };
    expect(body.projects.map((p) => p.id)).toContain(id);
  });

  it('filters projects by status', async () => {
    const ctx = await seedWorkforceClient();
    await seedProject(ctx, randName('Quoted'), 'quoted');
    await seedProject(ctx, randName('Active'), 'active');
    const res = await list(ctx, '?status=quoted');
    const body = await res.json() as { projects: Array<{ status: string }> };
    expect(body.projects.every((p) => p.status === 'quoted')).toBe(true);
  });

  it('400 when name is missing', async () => {
    const ctx = await seedWorkforceClient();
    const res = await create(ctx, { name: '' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('name_required');
  });

  it('returns project detail with empty assignments', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedProject(ctx, randName('Detail'));
    const res = await detail(ctx, id);
    expect(res.status).toBe(200);
    const body = await res.json() as { project: { id: string }; assignments: unknown[] };
    expect(body.project.id).toBe(id);
    expect(body.assignments).toEqual([]);
  });

  it('404 on detail of foreign-client project', async () => {
    const ctx = await seedWorkforceClient();
    const other = await seedWorkforceClient();
    const id = await seedProject(other, randName('Foreign'));
    const res = await detail(ctx, id);
    expect(res.status).toBe(404);
  });

  it('advances status quoted→active→done and rejects done→*', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedProject(ctx, randName('FSM'), 'quoted');

    let res = await patch(ctx, id, { status: 'active' });
    expect(res.status).toBe(200);
    expect((await res.json() as { project: { status: string } }).project.status).toBe('active');

    res = await patch(ctx, id, { status: 'done' });
    expect(res.status).toBe(200);
    expect((await res.json() as { project: { status: string } }).project.status).toBe('done');

    // Terminal — cannot advance further.
    res = await patch(ctx, id, { status: 'quoted' });
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('project_already_done');
  });

  it('422 on invalid transition (quoted→done)', async () => {
    const ctx = await seedWorkforceClient();
    const id = await seedProject(ctx, randName('BadFSM'), 'quoted');
    const res = await patch(ctx, id, { status: 'done' });
    expect(res.status).toBe(422);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('invalid_transition');
  });

  it('401 without auth', async () => {
    const res = await projectsHandler(new Request('http://localhost/api/workforce/projects'));
    expect(res.status).toBe(401);
  });
});

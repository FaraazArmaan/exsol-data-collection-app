import { describe, it, expect, beforeAll } from 'vitest';
import tasksHandler from '../../netlify/functions/workforce-project-tasks';
import taskHandler from '../../netlify/functions/workforce-project-task';
import riskHandler from '../../netlify/functions/workforce-project-risk';
import { seedWorkforceClient, makeBucketUserRequest, seedProject, randName, type WorkforceTestCtx } from './_helpers';

let ctx: WorkforceTestCtx;
beforeAll(async () => { ctx = await seedWorkforceClient(); });

const listTasks = (projectId: string, qs = '') =>
  tasksHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/project-tasks?project_id=${projectId}${qs}`));
const createTask = (body: unknown) =>
  tasksHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/project-tasks', body));
const patchTask = (id: string, body: unknown) =>
  taskHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/workforce/project-task/${id}`, body));
const deleteTask = (id: string) =>
  taskHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/workforce/project-task/${id}`));
const getRisk = (projectId: string) =>
  riskHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/project-risk/${projectId}`));

describe('project tasks & risk', () => {
  it('creates a task and lists it', async () => {
    const projId = await seedProject(ctx, randName('TaskProj'));
    const res = await createTask({ project_id: projId, title: randName('Task') });
    expect(res.status).toBe(201);
    const { task } = await res.json() as { task: { id: string; status: string } };
    expect(task.status).toBe('open');

    const listRes = await listTasks(projId);
    expect(listRes.status).toBe(200);
    const { tasks } = await listRes.json() as { tasks: Array<{ id: string }> };
    expect(tasks.map((t) => t.id)).toContain(task.id);
  });

  it('filters tasks by status', async () => {
    const projId = await seedProject(ctx, randName('FilterTask'));
    const r1 = await createTask({ project_id: projId, title: randName('Open') });
    const { task: t1 } = await r1.json() as { task: { id: string } };
    await patchTask(t1.id, { status: 'done' });

    const res = await listTasks(projId, '&status=open');
    const { tasks } = await res.json() as { tasks: Array<{ id: string }> };
    expect(tasks.map((t) => t.id)).not.toContain(t1.id);
  });

  it('patches task status', async () => {
    const projId = await seedProject(ctx, randName('PatchTask'));
    const r = await createTask({ project_id: projId, title: randName('T') });
    const { task } = await r.json() as { task: { id: string } };
    const patchRes = await patchTask(task.id, { status: 'in_progress' });
    expect(patchRes.status).toBe(200);
    const { task: updated } = await patchRes.json() as { task: { status: string } };
    expect(updated.status).toBe('in_progress');
  });

  it('deletes a task', async () => {
    const projId = await seedProject(ctx, randName('DeleteTask'));
    const r = await createTask({ project_id: projId, title: randName('Del') });
    const { task } = await r.json() as { task: { id: string } };
    const delRes = await deleteTask(task.id);
    expect(delRes.status).toBe(204);
    const listRes = await listTasks(projId);
    const { tasks } = await listRes.json() as { tasks: Array<{ id: string }> };
    expect(tasks.map((t) => t.id)).not.toContain(task.id);
  });

  it('GET risk returns health score and flags', async () => {
    const projId = await seedProject(ctx, randName('Risk'));
    const res = await getRisk(projId);
    expect(res.status).toBe(200);
    const { risk } = await res.json() as { risk: { health_score: number; flags: string[]; total_tasks: number } };
    expect(typeof risk.health_score).toBe('number');
    expect(Array.isArray(risk.flags)).toBe(true);
    expect(risk.total_tasks).toBe(0);
  });

  it('risk flags overdue task', async () => {
    const projId = await seedProject(ctx, randName('OverdueRisk'), 'active');
    await createTask({ project_id: projId, title: randName('OD'), due_date: '2020-01-01' });
    const res = await getRisk(projId);
    const { risk } = await res.json() as { risk: { overdue_count: number; flags: string[] } };
    expect(risk.overdue_count).toBeGreaterThan(0);
    expect(risk.flags.some((f) => f.includes('overdue'))).toBe(true);
  });

  it('risk flags unstaffed active project', async () => {
    const projId = await seedProject(ctx, randName('UnstaffedRisk'), 'active');
    const res = await getRisk(projId);
    const { risk } = await res.json() as { risk: { unstaffed: boolean } };
    expect(risk.unstaffed).toBe(true);
  });

  it('createTask 400 when title missing', async () => {
    const projId = await seedProject(ctx, randName('NoTitle'));
    const res = await createTask({ project_id: projId, title: '' });
    expect(res.status).toBe(400);
  });

  it('GET risk 404 for unknown project', async () => {
    const res = await getRisk('00000000-0000-0000-0000-000000000001');
    expect(res.status).toBe(404);
  });

  it('GET 401 without auth', async () => {
    const res = await tasksHandler(new Request('http://localhost/api/workforce/project-tasks?project_id=00000000-0000-0000-0000-000000000001'));
    expect(res.status).toBe(401);
  });
});

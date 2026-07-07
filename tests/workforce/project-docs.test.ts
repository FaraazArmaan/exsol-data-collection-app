import { describe, it, expect, beforeAll } from 'vitest';
import docsHandler from '../../netlify/functions/workforce-project-docs';
import { seedWorkforceClient, makeBucketUserRequest, seedProject, randName, type WorkforceTestCtx } from './_helpers';
import { neon } from '@neondatabase/serverless';

let ctx: WorkforceTestCtx;
beforeAll(async () => { ctx = await seedWorkforceClient(); });

const get = (projectId: string) =>
  docsHandler(makeBucketUserRequest(ctx, 'GET', `/api/workforce/project-docs?project_id=${projectId}`));
const post = (body: unknown) =>
  docsHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/project-docs', body));
const del = (body: unknown) =>
  docsHandler(makeBucketUserRequest(ctx, 'DELETE', '/api/workforce/project-docs', body));

// Seed a minimal file record directly in DB (bypasses blob upload flow).
// Uses uploaded_by_admin to satisfy the files_uploader_consistent CHECK constraint.
async function seedFile(ctx: WorkforceTestCtx): Promise<string> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    INSERT INTO public.files (client_id, type, storage_kind, external_url, title, tier, uploaded_by_admin)
    VALUES (${ctx.clientId}::uuid, 'external', 'url', 'https://example.com/doc.pdf', ${randName('Doc')}, 'public', ${ctx.adminId}::uuid)
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

describe('project document hub', () => {
  it('GET returns empty list for new project', async () => {
    const id = await seedProject(ctx, randName('Docs'));
    const res = await get(id);
    expect(res.status).toBe(200);
    const data = await res.json() as { docs: unknown[] };
    expect(Array.isArray(data.docs)).toBe(true);
    expect(data.docs.length).toBe(0);
  });

  it('POST links a file and GET returns it', async () => {
    const id = await seedProject(ctx, randName('DocsLink'));
    const fileId = await seedFile(ctx);
    const res = await post({ project_id: id, file_id: fileId });
    expect(res.status).toBe(201);
    const listRes = await get(id);
    const data = await listRes.json() as { docs: Array<{ file_id: string }> };
    expect(data.docs.map((d) => d.file_id)).toContain(fileId);
  });

  it('POST is idempotent (duplicate link returns 201)', async () => {
    const id = await seedProject(ctx, randName('DocsIdempotent'));
    const fileId = await seedFile(ctx);
    await post({ project_id: id, file_id: fileId });
    const res = await post({ project_id: id, file_id: fileId });
    expect(res.status).toBe(201);
  });

  it('DELETE unlinks a file', async () => {
    const id = await seedProject(ctx, randName('DocsUnlink'));
    const fileId = await seedFile(ctx);
    await post({ project_id: id, file_id: fileId });
    const res = await del({ project_id: id, file_id: fileId });
    expect(res.status).toBe(204);
    const listRes = await get(id);
    const data = await listRes.json() as { docs: Array<{ file_id: string }> };
    expect(data.docs.map((d) => d.file_id)).not.toContain(fileId);
  });

  it('DELETE 404 for non-existent link', async () => {
    const id = await seedProject(ctx, randName('DocsNoLink'));
    const fileId = await seedFile(ctx);
    const res = await del({ project_id: id, file_id: fileId });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('link_not_found');
  });

  it('GET 400 when project_id missing', async () => {
    const res = await docsHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/project-docs'));
    expect(res.status).toBe(400);
  });

  it('GET 401 without auth', async () => {
    const id = await seedProject(ctx, randName('DocsAuth'));
    const res = await docsHandler(new Request(`http://localhost/api/workforce/project-docs?project_id=${id}`));
    expect(res.status).toBe(401);
  });
});

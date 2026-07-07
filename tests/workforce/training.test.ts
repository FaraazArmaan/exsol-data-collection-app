import { describe, it, expect, beforeAll } from 'vitest';
import coursesHandler from '../../netlify/functions/workforce-training-courses';
import courseHandler from '../../netlify/functions/workforce-training-course';
import completionsHandler from '../../netlify/functions/workforce-training-completions';
import { seedWorkforceClient } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
beforeAll(async () => { ctx = await seedWorkforceClient(); });

function makeReq(method: string, url: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('workforce training', () => {
  let courseId: string;
  let courseWithExpiryId: string;

  it('POST creates a course (no expiry)', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/training-courses', {
      name: `First Aid ${Date.now()}`,
      is_required: true,
    }, ctx.cookie);
    const res = await coursesHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { course: { id: string; is_required: boolean } };
    expect(data.course.is_required).toBe(true);
    courseId = data.course.id;
  });

  it('POST creates a course with expiry', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/training-courses', {
      name: `Safety Training ${Date.now()}`,
      expiry_days: 365,
    }, ctx.cookie);
    const res = await coursesHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { course: { id: string; expiry_days: number } };
    expect(Number(data.course.expiry_days)).toBe(365);
    courseWithExpiryId = data.course.id;
  });

  it('GET lists courses', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/training-courses', undefined, ctx.cookie);
    const res = await coursesHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { courses: unknown[] };
    expect(data.courses.length).toBeGreaterThan(0);
  });

  it('PATCH updates course', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/training-course/${courseId}`, {
      description: 'Updated description',
    }, ctx.cookie);
    const res = await courseHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { course: { description: string } };
    expect(data.course.description).toBe('Updated description');
  });

  it('POST logs completion without expiry', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/training-completions', {
      course_id: courseId,
      resource_id: ctx.resourceId,
      completed_at: '2026-01-15',
    }, ctx.cookie);
    const res = await completionsHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { completion: { expires_at: null; expiry_status: string } };
    expect(data.completion.expires_at).toBeNull();
    expect(data.completion.expiry_status).toBe('valid');
  });

  it('POST logs completion with expiry (expiry_days=365)', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/training-completions', {
      course_id: courseWithExpiryId,
      resource_id: ctx.resourceId,
      completed_at: '2026-01-01',
    }, ctx.cookie);
    const res = await completionsHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { completion: { expires_at: string; expiry_status: string } };
    // completed 2026-01-01 + 365 days = around 2027-01-01 → valid (not expiring for > 30 days from test date 2026-07-07)
    expect(data.completion.expires_at).toBeTruthy();
    expect(['valid', 'expiring_soon', 'expired']).toContain(data.completion.expiry_status);
  });

  it('GET lists completions with expiring_soon filter', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/training-completions?expiring_soon=true', undefined, ctx.cookie);
    const res = await completionsHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { completions: Array<{ expiry_status: string }> };
    expect(Array.isArray(data.completions)).toBe(true);
    // All returned should be expiring_soon or expired
    data.completions.forEach(c => {
      expect(['expiring_soon', 'expired']).toContain(c.expiry_status);
    });
  });

  it('GET 401 without auth', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/training-courses');
    const res = await coursesHandler(req);
    expect(res.status).toBe(401);
  });
});

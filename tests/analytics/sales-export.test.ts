import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-sales-export';
import { seedPaidSales } from './_analytics-helpers';
import { seedSubordinateUser, makeBucketUserRequest } from '../pos/_helpers';

const FROM = '2026-05-04', TO = '2026-05-04';
let ctx: Awaited<ReturnType<typeof seedPaidSales>>;

beforeAll(async () => {
  ctx = await seedPaidSales({ when: [`${FROM}T10:00:00Z`], channel: ['instore'], priceCents: 700 });
});

describe('GET /api/analytics-sales-export', () => {
  it('csv export returns an attachment containing the revenue total', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET',
      `/api/analytics-sales-export?from=${FROM}&to=${TO}&format=csv`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-type')).toContain('csv');
    const text = await res.text();
    expect(text).toContain('700');
  });

  it('xlsx export returns a spreadsheet attachment', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET',
      `/api/analytics-sales-export?from=${FROM}&to=${TO}&format=xlsx`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const buf = new Uint8Array(await res.arrayBuffer());
    // XLSX files are ZIP archives — magic bytes 'PK'
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('rejects a caller lacking analytics.business.view', async () => {
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET',
      `/api/analytics-sales-export?from=${FROM}&to=${TO}&format=csv`));
    expect(res.status).toBe(403);
  });
});

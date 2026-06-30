import { describe, it, expect, beforeAll } from 'vitest';
import handler from '../../netlify/functions/analytics-sales';
import { seedPaidSales } from './_analytics-helpers';
import { makeBucketUserRequest } from '../pos/_helpers';

const FROM = '2026-04-10';
const TO = '2026-04-12';
let ctx: Awaited<ReturnType<typeof seedPaidSales>>;

beforeAll(async () => {
  // Two instore sales on 04-10 + one pickup on 04-11, 500c each.
  // Times are mid-day UTC so Asia/Kolkata (+5:30) bucketing keeps the same day.
  ctx = await seedPaidSales({
    when: [`${FROM}T09:00:00Z`, `${FROM}T15:00:00Z`, '2026-04-11T12:00:00Z'],
    channel: ['instore', 'instore', 'pickup'],
    priceCents: 500,
  });
});

describe('GET /api/analytics-sales series + breakdowns', () => {
  it('returns revenue-by-day points within the window', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET',
      `/api/analytics-sales?from=${FROM}&to=${TO}&granularity=day`));
    const body = await res.json();
    const series = body.series.find((s: any) => s.id === 'revenue_by_day');
    expect(series).toBeTruthy();
    const day1 = series.points.find((p: any) => p.x === FROM);
    expect(day1.y).toBe(1000); // two 500c sales on 04-10
  });

  it('breaks revenue down by channel', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET',
      `/api/analytics-sales?from=${FROM}&to=${TO}`));
    const body = await res.json();
    const ch = body.breakdowns.find((b: any) => b.id === 'by_channel');
    expect(ch).toBeTruthy();
    const instore = ch.rows.find((r: any) => r.key === 'instore');
    expect(instore.value).toBe(1000);
    const pickup = ch.rows.find((r: any) => r.key === 'pickup');
    expect(pickup.value).toBe(500);
  });

  it('includes a by_category breakdown', async () => {
    const res = await handler(makeBucketUserRequest(ctx, 'GET',
      `/api/analytics-sales?from=${FROM}&to=${TO}`));
    const body = await res.json();
    const cat = body.breakdowns.find((b: any) => b.id === 'by_category');
    expect(cat).toBeTruthy();
    // seeded product has no category → all revenue under 'Uncategorised'
    const total = cat.rows.reduce((a: number, r: any) => a + r.value, 0);
    expect(total).toBe(1500);
  });
});

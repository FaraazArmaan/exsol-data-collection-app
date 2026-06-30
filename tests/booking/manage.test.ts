import { describe, it, expect, beforeAll } from 'vitest';
import manage from '../../netlify/functions/booking-public-manage';
import { sqlClient, seedClientWithBooking, enableBooking, seedResource, makeService, setBookingSettings } from './_helpers';

const sql = sqlClient();
let ctx: Awaited<ReturnType<typeof seedClientWithBooking>>;
let resId: string, svc: string;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
  resId = await seedResource(ctx.clientId, 'Sarah');
  svc = await makeService(ctx.clientId, { duration_min: 60 });
  await setBookingSettings(ctx.clientId, { mon: [{ open: '09:00', close: '18:00' }] }, { cancel_cutoff_min: 60 });
});

async function mkBooking(range: string, token: string): Promise<void> {
  await sql`INSERT INTO public.bookings (bucket_id, service_id, resource_id, user_node_id, time_range, status, customer_name, manage_token)
    VALUES (${ctx.clientId}, ${svc}, ${resId}, ${ctx.ownerNodeId}, ${range}::tstzrange, 'confirmed', 'Riya', ${token})`;
}

function req(token: string, method: string, body?: unknown) {
  return new Request(`http://localhost/api/booking-public/manage/${token}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('magic-link manage', () => {
  it('unknown token → 404', async () => {
    expect((await manage(req('no-such-token', 'GET'))).status).toBe(404);
  });

  it('future booking is cancellable; cancel → cancelled', async () => {
    const tok = `tok-${crypto.randomUUID()}`;
    await mkBooking('[2031-05-01T09:00:00Z,2031-05-01T10:00:00Z)', tok);
    const get = await manage(req(tok, 'GET'));
    expect((await get.json()).cancellable).toBe(true);
    const cancel = await manage(req(tok, 'POST', { action: 'cancel' }));
    expect(cancel.status).toBe(200);
    expect((await cancel.json()).status).toBe('cancelled');
  });

  it('past-cutoff booking → not cancellable; cancel → 409 too_late_to_cancel', async () => {
    const tok = `tok-${crypto.randomUUID()}`;
    await mkBooking('[2020-05-01T09:00:00Z,2020-05-01T10:00:00Z)', tok);
    const get = await manage(req(tok, 'GET'));
    expect((await get.json()).cancellable).toBe(false);
    const cancel = await manage(req(tok, 'POST', { action: 'cancel' }));
    expect(cancel.status).toBe(409);
    expect((await cancel.json()).error.code).toBe('too_late_to_cancel');
  });
});

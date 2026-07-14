import { beforeAll, describe, expect, it } from 'vitest';
import publication from '../../netlify/functions/booking-publication';
import services from '../../netlify/functions/booking-public-services';
import surfaces from '../../netlify/functions/pub-site-surfaces';
import {
  bookingRequest,
  enableBooking,
  makeService,
  publishBooking,
  seedClientWithBooking,
  sqlClient,
  type BookingTestCtx,
  publicRequest,
} from './_helpers';

let ctx: BookingTestCtx;

beforeAll(async () => {
  ctx = await seedClientWithBooking();
  await enableBooking(ctx.clientId);
});

describe('Booking publication', () => {
  it('cannot publish before setup is complete and a service is active', async () => {
    const res = await publication(
      bookingRequest(ctx, 'PUT', '/api/booking/publication', { enabled: true }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('booking_setup_required');
  });

  it('cannot publish a completed setup without an active service', async () => {
    await publishBooking(ctx.clientId);
    const res = await publication(
      bookingRequest(ctx, 'PUT', '/api/booking/publication', { enabled: true }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('booking_not_ready_to_publish');
  });

  it('publishes only when ready and gates public catalog access', async () => {
    await makeService(ctx.clientId);
    await publishBooking(ctx.clientId);
    const enabled = await publication(
      bookingRequest(ctx, 'PUT', '/api/booking/publication', { enabled: true }),
    );
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({
      enabled: true,
      publicUrl: `https://exsoldatacollectionapp.netlify.app/storefront/${ctx.slug}/Book`,
    });
    const audit = (await sqlClient()`
      SELECT op, detail
      FROM public.audit_log
      WHERE client_id = ${ctx.clientId}::uuid AND op = 'booking.publication_toggled'
      ORDER BY occurred_at DESC
      LIMIT 1
    `) as Array<{ op: string; detail: { enabled: boolean } }>;
    expect(audit).toEqual([{ op: 'booking.publication_toggled', detail: { enabled: true } }]);

    expect((await services(publicRequest(ctx.slug, 'GET', '/services'))).status).toBe(200);
    const surface = await surfaces(
      new Request(`http://localhost/api/public/site-surfaces/${ctx.slug}`),
    );
    expect(surface.status).toBe(200);
    expect(await surface.json()).toMatchObject({ booking: true, shop: false });

    const disabled = await publication(
      bookingRequest(ctx, 'PUT', '/api/booking/publication', { enabled: false }),
    );
    expect(disabled.status).toBe(200);
    expect((await services(publicRequest(ctx.slug, 'GET', '/services'))).status).toBe(404);
  });
});

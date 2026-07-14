// GET /api/booking-public/:slug/availability — public projection of the same
// reservation rules enforced by every booking write.
import { jsonOk, jsonError } from './_shared/http';
import { pickLeastBusy } from '../../src/modules/booking/lib/autoassign';
import { getSequentialVisitAvailability } from './_booking-visits';
import { resolvePublicBooking } from './_booking-public';

export const config = { path: '/api/booking-public/:slug/availability', method: 'GET' };

function slugFrom(req: Request): string {
  const parts = new URL(req.url).pathname.split('/');
  return parts[parts.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const url = new URL(req.url);
  const serviceIds = (
    url.searchParams.get('service_ids') ??
    url.searchParams.get('service_id') ??
    ''
  )
    .split(',')
    .filter(Boolean);
  const date = url.searchParams.get('date') ?? '';
  const resourceId = url.searchParams.get('resource_id') ?? 'any';
  if (
    serviceIds.length === 0 ||
    serviceIds.some((serviceId) => !/^[0-9a-f-]{36}$/i.test(serviceId)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return jsonError(400, 'invalid_query');
  }
  const tenant = await resolvePublicBooking(slugFrom(req));
  if (!tenant) return jsonError(404, 'booking_unavailable');
  const availability = await getSequentialVisitAvailability({
    clientId: tenant.clientId,
    timeZone: tenant.timeZone,
    serviceIds,
    date,
    resourceId,
  });
  if (!availability.serviceFound) return jsonError(404, 'service_not_found');
  if (resourceId !== 'any') {
    return jsonOk({
      slots: availability.slots.map((slot) => ({
        start: slot.startUtc.toISOString(),
        end: slot.endUtc.toISOString(),
        resource_id: slot.resourceId,
      })),
    });
  }
  const byStart = new Map<string, string[]>();
  for (const slot of availability.slots) {
    const start = slot.startUtc.toISOString();
    const resources = byStart.get(start) ?? [];
    resources.push(slot.resourceId);
    byStart.set(start, resources);
  }
  const slots = [...byStart.entries()].map(([start, resourceIds]) => {
    const resourceId = pickLeastBusy(
      resourceIds.map((id) => ({ id, bookingsToday: availability.bookingCounts.get(id) ?? 0 })),
    )!;
    const slot = availability.slots.find(
      (candidate) =>
        candidate.startUtc.toISOString() === start && candidate.resourceId === resourceId,
    )!;
    return { start, end: slot.endUtc.toISOString(), resource_id: resourceId };
  });
  return jsonOk({ slots });
}

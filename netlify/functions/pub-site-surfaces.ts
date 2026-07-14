// GET /api/public/site-surfaces/:slug — public navigation capabilities only.
import { jsonOk } from './_shared/http';
import { resolveStorefront } from './_pub-authz';
import { resolvePublicBooking } from './_booking-public';

export const config = { path: '/api/public/site-surfaces/:slug', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const slug = new URL(req.url).pathname.split('/').pop() ?? '';
  const [shop, booking] = await Promise.all([resolveStorefront(slug), resolvePublicBooking(slug)]);
  return jsonOk({ shop: !!shop, booking: !!booking });
}

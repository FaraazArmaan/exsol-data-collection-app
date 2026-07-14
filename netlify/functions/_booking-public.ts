import { db } from './_shared/db';

export interface PublicBookingTenant {
  clientId: string;
  name: string;
  timeZone: string;
}

// Public Booking is deliberately independent from the ecommerce storefront toggle.
export async function resolvePublicBooking(slug: string): Promise<PublicBookingTenant | null> {
  if (!slug) return null;
  const rows = (await db()`
    SELECT c.id, c.name, c.timezone
    FROM public.clients c
    JOIN public.booking_setup bs ON bs.bucket_id = c.id
    WHERE c.slug = ${slug}
      AND bs.completed_at IS NOT NULL
      AND bs.public_enabled = true
      AND EXISTS (
        SELECT 1 FROM public.client_enabled_products cep
        WHERE cep.client_id = c.id AND cep.product_key = 'saloon-booking'
      )
      AND EXISTS (
        SELECT 1 FROM public.booking_services service
        WHERE service.bucket_id = c.id AND service.active = true
      )
    LIMIT 1
  `) as Array<{ id: string; name: string; timezone: string }>;
  const tenant = rows[0];
  return tenant ? { clientId: tenant.id, name: tenant.name, timeZone: tenant.timezone } : null;
}

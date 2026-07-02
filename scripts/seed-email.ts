#!/usr/bin/env tsx
// Seed realistic Email/Notifications demo data for papa-s-saloon.
//
//  1. Ensures the products that carry the email module (and the two wired flows)
//     are enabled: saloon-booking (booking + email) and pos (storefront + email),
//     plus products. Idempotent.
//  2. Populates email_outbox with branded, previewable rows — both templates,
//     mixed statuses + staggered timestamps — using the REAL template renderers,
//     so the vendor Outbox page is populated (and previews look production-exact).
//
// Run: npm run seed:email   (tsx --env-file=.env scripts/seed-email.ts)
import { neon } from '@neondatabase/serverless';
import {
  renderBookingConfirmation, renderStorefrontReceipt,
} from '../netlify/functions/_shared/email-templates';
import type { EmailBrand } from '../netlify/functions/_shared/brand-email';

const sql = neon(process.env.DATABASE_URL!);
const SLUG = 'papa-s-saloon';

async function main(): Promise<void> {
  const clients = (await sql`
    SELECT id, name, slug, brand_accent, brand_theme, brand_font_heading, brand_font_body, brand_logo_key
    FROM public.clients WHERE slug = ${SLUG} LIMIT 1
  `) as Array<{
    id: string; name: string; slug: string; brand_accent: string | null;
    brand_theme: 'dark' | 'light' | null; brand_font_heading: string | null;
    brand_font_body: string | null; brand_logo_key: string | null;
  }>;
  if (!clients[0]) {
    console.error(`Client "${SLUG}" not found in this database. Create it first, then re-run.`);
    process.exit(1);
  }
  const c = clients[0];
  const clientId = c.id;

  const admin = (await sql`SELECT id FROM public.admins ORDER BY is_bootstrap DESC LIMIT 1`) as Array<{ id: string }>;
  const adminId = admin[0]?.id ?? null;

  // Enable the products that carry booking + storefront + email. Enabling pos
  // also restores the products->pos invariant (migration 042) for this client.
  for (const key of ['saloon-booking', 'pos', 'products']) {
    await sql`
      INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
      VALUES (${clientId}, ${key}, ${adminId})
      ON CONFLICT (client_id, product_key) DO NOTHING
    `;
  }

  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  const brand: EmailBrand = {
    name: c.name,
    slug: c.slug,
    accent: c.brand_accent ?? '#3b82f6',
    theme: c.brand_theme ?? 'dark',
    fontHeading: c.brand_font_heading,
    fontBody: c.brand_font_body,
    logoUrl: c.brand_logo_key ? `${base}/api/public/brand/${encodeURIComponent(c.slug)}/image/${c.brand_logo_key}` : null,
  };

  // Keep re-runs tidy — only clear our own demo recipients.
  await sql`DELETE FROM public.email_outbox WHERE client_id = ${clientId} AND to_email LIKE '%@demo.exsol'`;

  const bc1 = renderBookingConfirmation(brand, { customerName: 'Ada Lovelace', serviceName: 'Signature Cut & Style', startIso: '2026-07-12T10:00:00.000Z', endIso: '2026-07-12T11:00:00.000Z', priceCents: 45000, uid: 'seed-bc1@exsol' });
  const bc2 = renderBookingConfirmation(brand, { customerName: 'Grace Hopper', serviceName: 'Beard Trim', startIso: '2026-07-13T14:30:00.000Z', endIso: '2026-07-13T15:00:00.000Z', priceCents: 20000, uid: 'seed-bc2@exsol' });
  const rc1 = renderStorefrontReceipt(brand, { customerName: 'Alan Turing', orderNo: 1042, lines: [{ productName: 'Pomade', qty: 1, unitPriceCents: 18000, lineTotalCents: 18000 }, { productName: 'Beard Oil', qty: 2, unitPriceCents: 22000, lineTotalCents: 44000 }], subtotalCents: 62000, totalCents: 62000 });
  const rc2 = renderStorefrontReceipt(brand, { customerName: 'Katherine Johnson', orderNo: 1043, lines: [{ productName: 'Shampoo (500ml)', qty: 1, unitPriceCents: 30000, lineTotalCents: 30000 }], subtotalCents: 30000, totalCents: 30000 });

  const demo: Array<{
    to: string; template: 'booking_confirmation' | 'storefront_receipt';
    subject: string; html: string; status: string; daysAgo: number; error?: string;
  }> = [
    { to: 'ada@demo.exsol',       template: 'booking_confirmation', subject: bc1.subject, html: bc1.html, status: 'sent',   daysAgo: 1 },
    { to: 'grace@demo.exsol',     template: 'booking_confirmation', subject: bc2.subject, html: bc2.html, status: 'logged', daysAgo: 2 },
    { to: 'alan@demo.exsol',      template: 'storefront_receipt',   subject: rc1.subject, html: rc1.html, status: 'sent',   daysAgo: 1 },
    { to: 'katherine@demo.exsol', template: 'storefront_receipt',   subject: rc2.subject, html: rc2.html, status: 'failed', daysAgo: 3, error: 'resend_422: demo bounce (invalid recipient)' },
  ];

  for (const r of demo) {
    const created = new Date(Date.now() - r.daysAgo * 86_400_000).toISOString();
    const sent = r.status === 'sent' ? created : null;
    await sql`
      INSERT INTO public.email_outbox
        (client_id, to_email, template, subject, payload, body_html, status, provider_id, error, created_at, sent_at)
      VALUES (${clientId}, ${r.to}, ${r.template}, ${r.subject}, '{}'::jsonb, ${r.html}, ${r.status},
              ${r.status === 'sent' ? `demo-${r.to}` : null}, ${r.error ?? null},
              ${created}::timestamptz, ${sent}::timestamptz)
    `;
  }

  console.log(`Seeded ${demo.length} email_outbox rows for ${SLUG} (${clientId}); enabled saloon-booking + pos + products.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

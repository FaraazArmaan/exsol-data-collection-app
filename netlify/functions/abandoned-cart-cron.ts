// Scheduled function: emails guests who left a cart. Sweeps 'active' abandoned
// carts that went cold (no save for STALE_MINUTES) but aren't ancient (<7 days),
// sends one reminder via the low-level deliver() seam (NOT sendMail — this isn't
// one of the two locked email_outbox templates), and flips status → 'reminded'
// so nobody is nudged twice. Works for pay-on-pickup too; the link just returns
// them to the storefront to finish. Runs every 15 minutes across all tenants.
//
// NOTE: Netlify scheduled functions — verify the cron registers on first deploy.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { db } from './_shared/db';
import { deliver } from './_shared/resend';
import { publicStorefrontUrl } from '../../src/modules/pos/lib/storefront-path';

export const config = { schedule: '*/15 * * * *' };

const STALE_MINUTES = 30;
const BATCH = 100;

interface CartLine { name: string; qty: number; unitPriceCents: number }
interface CartRow {
  id: string;
  customer_name: string | null;
  customer_email: string;
  lines: CartLine[];
  subtotal_cents: number;
  client_name: string;
  slug: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
function rupees(cents: number): string {
  return `₹${(cents / 100).toFixed(2)}`;
}

function reminderHtml(cart: CartRow, link: string): string {
  const rows = cart.lines
    .map((l) => `<tr><td style="padding:4px 0">${esc(l.name)} × ${l.qty}</td><td style="padding:4px 0;text-align:right">${rupees(l.unitPriceCents * l.qty)}</td></tr>`)
    .join('');
  const cta = link
    ? `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#fff;border-radius:6px;text-decoration:none">Complete your order</a></p>`
    : '';
  return (
    `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">` +
    `<p>Hi ${esc(cart.customer_name || 'there')}, you left a few things in your cart at ${esc(cart.client_name)}:</p>` +
    `<table style="width:100%;font-size:14px;border-collapse:collapse">${rows}` +
    `<tr><td style="padding-top:8px;border-top:1px solid #e4e4e7;font-weight:700">Total</td>` +
    `<td style="padding-top:8px;border-top:1px solid #e4e4e7;text-align:right;font-weight:700">${rupees(cart.subtotal_cents)}</td></tr></table>` +
    cta +
    `</div>`
  );
}

/** Send reminders for cold active carts. Returns {reminded} count. */
export async function sweepAbandonedCarts(
  sql: NeonQueryFunction<false, false>,
  opts: { staleMinutes?: number } = {},
): Promise<{ reminded: number }> {
  const stale = opts.staleMinutes ?? STALE_MINUTES;
  const carts = (await sql`
    SELECT ac.id, ac.customer_name, ac.customer_email, ac.lines, ac.subtotal_cents,
           c.name AS client_name, c.slug
    FROM public.abandoned_carts ac
    JOIN public.clients c ON c.id = ac.client_id
    WHERE ac.status = 'active'
      AND ac.updated_at < now() - make_interval(mins => ${stale})
      AND ac.updated_at > now() - interval '7 days'
    ORDER BY ac.updated_at ASC
    LIMIT ${BATCH}
  `) as CartRow[];

  const base = process.env.URL || process.env.SITE_URL || process.env.PUBLIC_BASE_URL || '';
  const from = process.env.MAIL_FROM || 'notifications@example.com';
  let reminded = 0;

  for (const cart of carts) {
    const link = publicStorefrontUrl(cart.slug, base);
    const res = await deliver({
      to: cart.customer_email,
      from,
      subject: `You left items in your cart — ${cart.client_name}`,
      html: reminderHtml(cart, link),
    });
    // Mark reminded on any non-hard-failure (dev logs count) so we never re-nudge.
    if (res.ok) {
      await sql`UPDATE public.abandoned_carts SET status = 'reminded', reminded_at = now() WHERE id = ${cart.id}::uuid`;
      reminded++;
    }
  }
  return { reminded };
}

export default async function handler(): Promise<Response> {
  const { reminded } = await sweepAbandonedCarts(db());
  return new Response(JSON.stringify({ reminded }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

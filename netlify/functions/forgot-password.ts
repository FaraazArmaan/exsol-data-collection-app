// POST /api/forgot-password
//   Body: { email: string, client?: <slug> }
//
// Admin-mediated reset request. Bucket-user submits their email; we flip
// password_reset_requested_at on every matching credential so the admin sees
// a badge on the chip and the Sign-in panel. There is no self-serve reset
// link (no email infrastructure yet) — admins issue a new temp password
// through EditUserNodeModal / LoginManageModal and share it out-of-band.
//
// Security:
//   - Always returns the same generic success response, regardless of whether
//     the email matches anything. Prevents account enumeration.
//   - Per-credential 5-minute cooldown enforced in the UPDATE WHERE clause —
//     repeat requests are idempotent NOOPs, indistinguishable in the response.
//   - Admin emails are intentionally NOT included. Admins don't go through
//     this flow; if/when self-serve admin reset is added it will be a
//     separate endpoint.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';

const Body = z.object({
  email: z.string().email().max(254),
  client: z.string().min(1).max(80).optional(),
});

const COOLDOWN_SECONDS = 5 * 60;

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  const email = parsed.data.email;

  if (parsed.data.client) {
    const c = (await sql`
      SELECT id FROM public.clients WHERE slug = ${parsed.data.client} LIMIT 1
    `) as { id: string }[];
    if (c.length > 0) {
      await sql`
        UPDATE public.user_node_credentials
        SET password_reset_requested_at = now()
        WHERE email = ${email}
          AND client_id = ${c[0]!.id}::uuid
          AND (password_reset_requested_at IS NULL
               OR password_reset_requested_at < now() - (${COOLDOWN_SECONDS} || ' seconds')::interval)
      `;
    }
  } else {
    // No client slug — flip the flag on every matching credential across clients.
    await sql`
      UPDATE public.user_node_credentials
      SET password_reset_requested_at = now()
      WHERE email = ${email}
        AND (password_reset_requested_at IS NULL
             OR password_reset_requested_at < now() - (${COOLDOWN_SECONDS} || ' seconds')::interval)
    `;
  }

  return jsonOk({
    ok: true,
    message: 'If an account exists for this email, an admin has been notified to reset the password.',
  });
};

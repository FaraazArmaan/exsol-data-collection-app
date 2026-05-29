// POST /api/u-link-google
//   Auth: bu_session cookie required (must be a logged-in bucket user)
//   Body: { idToken }
//
// First-binds a Google identity to the authenticated bucket user's credential
// row. Refuses if the user already has a google_sub bound (returns 409
// google_already_linked) so callers can't silently swap identities.
//
// Also refuses if the Google email doesn't match the credential email —
// users must use the same email at Google as the one their admin registered,
// otherwise we'd be binding a stranger's identity to their account.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { verifyGoogleIdToken } from './_shared/google-verifier';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';

const Body = z.object({ idToken: z.string().min(10) });

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  let actor;
  try { actor = await requireBucketUser(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  let profile;
  try {
    profile = await verifyGoogleIdToken(parsed.data.idToken);
  } catch {
    return jsonError(401, 'google_token_invalid');
  }
  if (!profile.emailVerified) return jsonError(401, 'google_email_unverified');

  // Email must match — defends against linking a stranger's Google identity.
  if (profile.email.toLowerCase() !== actor.credential.email.toLowerCase()) {
    return jsonError(409, 'google_email_mismatch');
  }

  const sql = db();
  // Refuse to overwrite an existing binding.
  const cur = (await sql`
    SELECT google_sub FROM public.user_node_credentials WHERE id = ${actor.credential.id}
  `) as { google_sub: string | null }[];
  if (cur[0]?.google_sub && cur[0].google_sub !== profile.sub) {
    return jsonError(409, 'google_already_linked');
  }

  try {
    await sql`
      UPDATE public.user_node_credentials
         SET google_sub = ${profile.sub}
       WHERE id = ${actor.credential.id}
         AND (google_sub IS NULL OR google_sub = ${profile.sub})
    `;
  } catch (e: unknown) {
    // Partial unique index (client_id, google_sub) could collide if a different
    // credential in the same client already claimed this Google identity.
    const code = (e as { code?: string })?.code;
    if (code === '23505') return jsonError(409, 'google_already_claimed_in_this_workspace');
    throw e;
  }

  return jsonOk({ ok: true });
};

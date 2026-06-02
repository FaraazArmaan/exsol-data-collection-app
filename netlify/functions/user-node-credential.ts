// GET    ?node=<id>  → { has_credential, must_change_password, last_login_at,
//                        temp_password_plain?, temp_password_views_left? }
//   The GET counts as a reveal — decrements views, wipes plaintext at 0.
// POST   ?node=<id>  body { temp_password } → reset
// DELETE ?node=<id>  → removes the credential

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { hashPassword } from './_shared/argon';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';

const ResetBody = z.object({ temp_password: z.string().min(8).max(200) });

interface FullCredential {
  id: string;
  client_id: string;
  email: string;
  must_change_password: boolean;
  temp_password_plain: string | null;
  temp_password_views_left: number | null;
  last_login_at: string | null;
  has_password: boolean;
  has_google: boolean;
  password_reset_requested_at: string | null;
}

export default async (req: Request, _ctx: Context) => {
  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const url = new URL(req.url);
  const nodeId = url.searchParams.get('node');
  if (!nodeId) return jsonError(400, 'validation_failed', 'node required');
  try { assertUuid(nodeId, 'node'); } catch { return jsonError(400, 'validation_failed', 'node must be uuid'); }

  const sql = db();

  // Look up node + role to confirm existence; needed for POST email lookup.
  const nodeRows = (await sql`
    SELECT id, client_id, email FROM public.user_nodes WHERE id = ${nodeId}::uuid LIMIT 1
  `) as { id: string; client_id: string; email: string | null }[];
  if (nodeRows.length === 0) return jsonError(404, 'user_node_not_found');
  const node = nodeRows[0]!;

  if (req.method === 'GET') {
    // peek=1 returns status only — does NOT decrement the reveal counter
    // and does NOT include the plaintext temp password. Use this when an
    // admin UI needs to display badges like "has password / has Google /
    // last login" without consuming a reveal view.
    const peek = url.searchParams.get('peek') === '1';

    const rows = (await sql`
      SELECT id, client_id, email, must_change_password, temp_password_plain,
             temp_password_views_left, last_login_at,
             (password_hash IS NOT NULL) AS has_password,
             (google_sub IS NOT NULL)    AS has_google,
             password_reset_requested_at
      FROM public.user_node_credentials
      WHERE user_node_id = ${nodeId}::uuid LIMIT 1
    `) as FullCredential[];
    const cred = rows[0];
    if (!cred) return jsonOk({ has_credential: false });

    if (peek) {
      return jsonOk({
        has_credential: true,
        email: cred.email,
        has_password: cred.has_password,
        has_google: cred.has_google,
        must_change_password: cred.must_change_password,
        last_login_at: cred.last_login_at,
        password_reset_requested_at: cred.password_reset_requested_at,
      });
    }

    let plain = cred.temp_password_plain;
    let viewsLeft = cred.temp_password_views_left;
    if (plain && typeof viewsLeft === 'number' && viewsLeft > 0) {
      const newViews = viewsLeft - 1;
      if (newViews <= 0) {
        await sql`
          UPDATE public.user_node_credentials
          SET temp_password_plain = NULL, temp_password_views_left = NULL
          WHERE id = ${cred.id}
        `;
        viewsLeft = 0;
      } else {
        await sql`
          UPDATE public.user_node_credentials
          SET temp_password_views_left = ${newViews}
          WHERE id = ${cred.id}
        `;
        viewsLeft = newViews;
      }
    } else {
      plain = null;
    }
    return jsonOk({
      has_credential: true,
      email: cred.email,
      has_password: cred.has_password,
      has_google: cred.has_google,
      must_change_password: cred.must_change_password,
      last_login_at: cred.last_login_at,
      password_reset_requested_at: cred.password_reset_requested_at,
      temp_password_plain: plain,
      temp_password_views_left: viewsLeft,
    });
  }

  if (req.method === 'POST') {
    if (!node.email) return jsonError(400, 'user_node_email_missing');
    const parsed = ResetBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    const pwdHash = await hashPassword(parsed.data.temp_password);

    try {
      await sql`
        INSERT INTO public.user_node_credentials (
          client_id, user_node_id, email, password_hash, must_change_password,
          temp_password_plain, temp_password_views_left, created_by_admin
        ) VALUES (
          ${node.client_id}::uuid, ${nodeId}::uuid, ${node.email},
          ${pwdHash}, true, ${parsed.data.temp_password}, 3, ${actor.admin.id}::uuid
        )
        ON CONFLICT (user_node_id) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              must_change_password = true,
              temp_password_plain = EXCLUDED.temp_password_plain,
              temp_password_views_left = 3,
              email = EXCLUDED.email,
              password_reset_requested_at = NULL
      `;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === '23505') return jsonError(409, 'email_already_has_login_in_this_client');
      throw e;
    }
    return jsonOk({ ok: true });
  }

  if (req.method === 'DELETE') {
    await sql`DELETE FROM public.user_node_credentials WHERE user_node_id = ${nodeId}::uuid`;
    return jsonOk({ ok: true });
  }

  return jsonError(405, 'method_not_allowed');
};

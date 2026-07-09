// GET /api/u-credential-token?token=... validates a public invite/reset token.
// POST /api/u-credential-token consumes it and sets the workspace password.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { hashPassword } from './_shared/argon';
import { consumeCredentialToken, getCredentialToken } from './_shared/credential-tokens';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

const SetPasswordBody = z.object({
  token: z.string().min(20).max(300),
  password: z.string().min(8).max(200),
});

export default async (req: Request, _ctx: Context) => {
  const sql = db();

  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token');
    if (!token) return jsonError(400, 'validation_failed', 'token required');
    const row = await getCredentialToken(sql, token);
    if (!row) return jsonError(404, 'token_not_found');
    if (row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return jsonError(410, row.consumed_at ? 'token_used' : 'token_expired');
    }
    return jsonOk({
      purpose: row.purpose,
      email: row.email,
      display_name: row.display_name,
      client: { id: row.client_id, slug: row.client_slug, name: row.client_name },
      expires_at: row.expires_at,
    });
  }

  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  const parsed = SetPasswordBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const tokenRow = await consumeCredentialToken(sql, parsed.data.token);
  if (!tokenRow) {
    const row = await getCredentialToken(sql, parsed.data.token);
    if (!row) return jsonError(404, 'token_not_found');
    return jsonError(410, row.consumed_at ? 'token_used' : 'token_expired');
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await sql`
    UPDATE public.user_node_credentials
    SET password_hash = ${passwordHash},
        must_change_password = false,
        temp_password_plain = NULL,
        temp_password_views_left = NULL,
        password_reset_requested_at = NULL,
        password_changed_at = now()
    WHERE id = ${tokenRow.credential_id}::uuid
      AND user_node_id = ${tokenRow.user_node_id}::uuid
      AND client_id = ${tokenRow.client_id}::uuid
  `;

  return jsonOk({
    ok: true,
    client: { id: tokenRow.client_id, slug: tokenRow.client_slug, name: tokenRow.client_name },
  });
};

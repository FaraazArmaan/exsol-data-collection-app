import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { generateTotpSecret, getAdminMfa, totpUri } from './_shared/mfa';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  try {
    const { admin } = await requireAdmin(req);
    const sql = db();
    const existing = await getAdminMfa(sql, admin.id);
    if (existing?.enabled_at) return jsonError(409, 'mfa_already_enabled');

    const secret = generateTotpSecret();
    await sql`
      INSERT INTO public.admin_mfa (admin_id, totp_secret, enabled_at, recovery_code_hashes)
      VALUES (${admin.id}::uuid, ${secret}, NULL, '[]'::jsonb)
      ON CONFLICT (admin_id)
      DO UPDATE SET totp_secret = EXCLUDED.totp_secret,
                    enabled_at = NULL,
                    recovery_code_hashes = '[]'::jsonb
    `;
    return jsonOk({
      secret,
      otpauth_url: totpUri({ issuer: 'ExSol', account: admin.email, secret }),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
};

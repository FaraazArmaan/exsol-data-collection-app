import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { generateRecoveryCodes, getAdminMfa, verifyTotp } from './_shared/mfa';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

const Body = z.object({ code: z.string().min(6).max(20) });

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  try {
    const { admin } = await requireAdmin(req);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    const sql = db();
    const mfa = await getAdminMfa(sql, admin.id);
    if (!mfa) return jsonError(409, 'mfa_not_started');
    if (mfa.enabled_at) return jsonError(409, 'mfa_already_enabled');
    if (!verifyTotp(mfa.totp_secret, parsed.data.code)) return jsonError(401, 'invalid_mfa_code');

    const recovery = await generateRecoveryCodes();
    await sql`
      UPDATE public.admin_mfa
      SET enabled_at = now(),
          recovery_code_hashes = ${JSON.stringify(recovery.hashes)}::jsonb
      WHERE admin_id = ${admin.id}::uuid
    `;
    return jsonOk({ enabled: true, recovery_codes: recovery.codes });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
};

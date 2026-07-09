import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { consumeRecoveryCode, getAdminMfa, verifyTotp } from './_shared/mfa';
import { jsonError, jsonOk } from './_shared/http';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

const Body = z.object({
  code: z.string().min(6).max(20).optional(),
  recovery_code: z.string().min(6).max(40).optional(),
}).refine((d) => !!d.code || !!d.recovery_code, { message: 'mfa_code_required' });

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
    if (!mfa?.enabled_at) return jsonError(409, 'mfa_not_enabled');

    const ok = parsed.data.code
      ? verifyTotp(mfa.totp_secret, parsed.data.code)
      : await consumeRecoveryCode(sql, admin.id, parsed.data.recovery_code!, mfa.recovery_code_hashes);
    if (!ok) return jsonError(401, 'invalid_mfa_code');

    await sql`
      UPDATE public.admin_mfa
      SET enabled_at = NULL,
          recovery_code_hashes = '[]'::jsonb
      WHERE admin_id = ${admin.id}::uuid
    `;
    await logAudit(sql, {
      session: { kind: 'admin', admin: { id: admin.id, email: admin.email } },
      op: 'admin.mfa_disabled',
      clientId: null,
      targetType: 'admin',
      targetId: admin.id,
      detail: { method: parsed.data.code ? 'totp' : 'recovery_code' },
    });
    return jsonOk({ enabled: false });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
};

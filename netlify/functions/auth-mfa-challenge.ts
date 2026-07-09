import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { consumeAdminMfaChallenge, consumeRecoveryCode, getAdminMfa, verifyTotp } from './_shared/mfa';
import { cookieHeader, mintSession } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

const Body = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().min(6).max(20).optional(),
  recovery_code: z.string().min(6).max(40).optional(),
}).refine((d) => !!d.code || !!d.recovery_code, { message: 'mfa_code_required' });

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();
  const challenge = await consumeAdminMfaChallenge(sql, parsed.data.challenge_id);
  if (!challenge) return jsonError(401, 'invalid_mfa_challenge');

  const adminRows = (await sql`
    SELECT id, email, display_name, is_bootstrap, disabled_at, locked_until
    FROM public.admins
    WHERE id = ${challenge.adminId}::uuid
    LIMIT 1
  `) as {
    id: string;
    email: string;
    display_name: string;
    is_bootstrap: boolean;
    disabled_at: string | null;
    locked_until: string | null;
  }[];
  const admin = adminRows[0];
  if (!admin) return jsonError(401, 'unauthorized');
  if (admin.disabled_at || (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now())) {
    return jsonError(401, 'unauthorized');
  }

  const mfa = await getAdminMfa(sql, admin.id);
  if (!mfa?.enabled_at) return jsonError(401, 'mfa_not_enabled');

  const ok = parsed.data.code
    ? verifyTotp(mfa.totp_secret, parsed.data.code)
    : await consumeRecoveryCode(sql, admin.id, parsed.data.recovery_code!, mfa.recovery_code_hashes);
  if (!ok) return jsonError(401, 'invalid_mfa_code');

  const token = await mintSession(
    { sub: admin.id, email: admin.email },
    { ip: challenge.ip, userAgent: challenge.userAgent },
  );
  return jsonOk({ kind: 'admin', admin }, { headers: { 'Set-Cookie': cookieHeader(token) } });
};

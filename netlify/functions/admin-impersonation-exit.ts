import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { jsonError, jsonOk } from './_shared/http';
import {
  clearBuCookieHeader,
  readBuCookieToken,
  revokeSession,
  verifyBucketUserSession,
} from './_shared/session';
import { rejectCrossSiteMutation } from './_shared/csrf';

function clearImpCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  const token = readBuCookieToken(req);
  if (!token) {
    const res = jsonOk({ ok: true, redirect_to: '/' });
    res.headers.append('Set-Cookie', clearBuCookieHeader());
    res.headers.append('Set-Cookie', clearImpCookie('imp_ctx'));
    res.headers.append('Set-Cookie', clearImpCookie('imp_actor'));
    res.headers.append('Set-Cookie', clearImpCookie('imp_started'));
    return res;
  }

  try {
    const claims = await verifyBucketUserSession(token);
    const sql = db();
    const startedAt = claims.impersonation_started_at ? new Date(claims.impersonation_started_at) : null;
    const endedAt = new Date();
    const durationSeconds = startedAt && !Number.isNaN(startedAt.getTime())
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : null;

    if (claims.impersonated_by_admin) {
      await logAudit(sql, {
        session: {
          kind: 'bucket_user',
          user_node_id: claims.sub,
          client_id: claims.client_id,
          level_number: 1,
          impersonated_by_admin: claims.impersonated_by_admin,
          impersonation_started_at: claims.impersonation_started_at,
          impersonation_reason: claims.impersonation_reason,
        },
        op: 'admin.impersonation_ended',
        clientId: claims.client_id,
        targetType: 'client',
        targetId: claims.client_id,
        detail: {
          started_at: claims.impersonation_started_at ?? null,
          ended_at: endedAt.toISOString(),
          duration_seconds: durationSeconds,
          reason: claims.impersonation_reason ?? null,
        },
      });
    }

    await revokeSession(claims.jti);
  } catch {
    // Exit should still clear a stale or malformed workspace cookie.
  }

  const res = jsonOk({ ok: true, redirect_to: '/' });
  res.headers.append('Set-Cookie', clearBuCookieHeader());
  res.headers.append('Set-Cookie', clearImpCookie('imp_ctx'));
  res.headers.append('Set-Cookie', clearImpCookie('imp_actor'));
  res.headers.append('Set-Cookie', clearImpCookie('imp_started'));
  return res;
};

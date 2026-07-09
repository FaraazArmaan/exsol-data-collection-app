import type { Context } from '@netlify/functions';
import { clearCookieHeader, readCookieToken, revokeSession, verifySession } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  const token = readCookieToken(req);
  if (token) {
    try {
      const claims = await verifySession(token);
      await revokeSession(claims.jti);
    } catch {
      // Logout still clears a stale or malformed browser cookie.
    }
  }
  return jsonOk({ ok: true }, { headers: { 'Set-Cookie': clearCookieHeader() } });
};

import type { Context } from '@netlify/functions';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { cookieHeader, mintSession, revokeSession, shouldRefresh } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  try {
    const { admin, claims } = await requireAdmin(req);
    const headers: Record<string, string> = {};
    if (shouldRefresh(claims)) {
      const fresh = await mintSession({ sub: admin.id, email: admin.email });
      await revokeSession(claims.jti);
      headers['Set-Cookie'] = cookieHeader(fresh);
    }
    return jsonOk({ admin }, { headers });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
};

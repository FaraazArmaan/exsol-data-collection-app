import type { Context } from '@netlify/functions';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { clearCookieHeader, revokeAllSessions } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  try {
    const { admin } = await requireAdmin(req);
    await revokeAllSessions({ realm: 'admin', subjectId: admin.id });
    return jsonOk({ ok: true }, { headers: { 'Set-Cookie': clearCookieHeader() } });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
};

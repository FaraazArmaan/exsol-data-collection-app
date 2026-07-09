import type { Context } from '@netlify/functions';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { clearBuCookieHeader, revokeAllSessions } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  try {
    const { credential } = await requireBucketUser(req);
    await revokeAllSessions({
      realm: 'bucket_user',
      subjectId: credential.user_node_id,
      clientId: credential.client_id,
    });
    return jsonOk({ ok: true }, { headers: { 'Set-Cookie': clearBuCookieHeader() } });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
};

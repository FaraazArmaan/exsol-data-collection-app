import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { getAdminMfa } from './_shared/mfa';
import { jsonError, jsonOk } from './_shared/http';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  try {
    const { admin } = await requireAdmin(req);
    const mfa = await getAdminMfa(db(), admin.id);
    return jsonOk({
      enabled: !!mfa?.enabled_at,
      recovery_codes_remaining: Array.isArray(mfa?.recovery_code_hashes)
        ? mfa!.recovery_code_hashes.length
        : 0,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }
};

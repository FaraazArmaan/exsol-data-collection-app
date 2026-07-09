import type { Context } from '@netlify/functions';
import { clearCookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';
import { rejectCrossSiteMutation } from './_shared/csrf';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  return jsonOk({ ok: true }, { headers: { 'Set-Cookie': clearCookieHeader() } });
};

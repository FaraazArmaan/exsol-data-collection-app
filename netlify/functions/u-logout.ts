import type { Context } from '@netlify/functions';
import { clearBuCookieHeader } from './_shared/session';
import { jsonError, jsonOk } from './_shared/http';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  return jsonOk({ ok: true }, { headers: { 'Set-Cookie': clearBuCookieHeader() } });
};

// GET  /api/client-settings/storefront → { enabled, publicUrl }
// PATCH/api/client-settings/storefront { enabled: boolean } → { enabled, publicUrl }
//
// The L1 Owner self-serve toggle for the public storefront (spec §5.4). Gated
// by the existing `_platform.settings.edit` permission (L1 Owners always hold
// it via the requirePermission bypass) — no storefront-specific permission key.
// Single function handles both methods on a unique path (no config.method
// collision). The public URL uses the request origin so preview aliases and custom
// domains cannot accidentally direct workspace users to production.

import { z } from 'zod';
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import {
  authenticateForPermission, resolveClientIdOrRespond,
} from './_shared/permissions';
import { rejectCrossSiteMutation } from './_shared/csrf';
import { publicOrderingUrl } from './_public-site-url';

export const config = { path: '/api/client-settings/storefront' };

const PatchBody = z.object({ enabled: z.boolean() });

function publicUrlFor(req: Request, slug: string): string {
  return publicOrderingUrl(slug, new URL(req.url).origin);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return jsonError(405, 'method_not_allowed');
  }
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  const auth = await authenticateForPermission(req, '_platform.settings.edit');
  if (auth instanceof Response) return auth;
  const scope = resolveClientIdOrRespond(auth, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT slug, storefront_enabled FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
    `) as Array<{ slug: string; storefront_enabled: boolean }>;
    if (!rows[0]) return jsonError(404, 'client_not_found');
    return jsonOk({ enabled: rows[0].storefront_enabled, publicUrl: publicUrlFor(req, rows[0].slug) });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const updated = (await sql`
    UPDATE public.clients SET storefront_enabled = ${parsed.data.enabled}
    WHERE id = ${clientId}::uuid
    RETURNING slug, storefront_enabled
  `) as Array<{ slug: string; storefront_enabled: boolean }>;
  if (!updated[0]) return jsonError(404, 'client_not_found');

  await logAudit(sql, {
    session: auth,
    op: 'client.storefront_toggled',
    clientId,
    targetType: 'client',
    targetId: clientId,
    detail: { enabled: parsed.data.enabled },
  });

  return jsonOk({ enabled: updated[0].storefront_enabled, publicUrl: publicUrlFor(req, updated[0].slug) });
}

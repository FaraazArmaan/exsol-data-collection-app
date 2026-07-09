// POST /api/client-settings/brand-image — authed brand image upload.
// Multipart { kind, file } → writes the blob, returns { key }. Gated by
// _platform.settings.edit (L1 Owners pass via requirePermission's L1 bypass).
// Does NOT touch clients — the PATCH endpoint stores the key. See branding spec §5.2.
import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import {
  brandStore, brandKey, heroKey, sniffImageMime,
  BRAND_ALLOWED_MIME, MAX_BRAND_BYTES, type BrandKind, type StableBrandKind,
} from './_shared/brand';
import { rejectCrossSiteMutation } from './_shared/csrf';

export const config = { path: '/api/client-settings/brand-image', method: 'POST' };

const STABLE: readonly StableBrandKind[] = ['logo', 'logo_alt', 'favicon', 'app_icon', 'social'];
function isBrandKind(v: unknown): v is BrandKind {
  return typeof v === 'string' && (v === 'hero' || (STABLE as readonly string[]).includes(v));
}

export default async (req: Request, _ctx?: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  const auth = await authenticateForPermission(req, '_platform.settings.edit');
  if (auth instanceof Response) return auth;
  const scope = resolveClientIdOrRespond(auth, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) return jsonError(400, 'multipart_required');
  let form: FormData;
  try { form = await req.formData(); } catch { return jsonError(400, 'invalid_multipart'); }

  const kind = form.get('kind');
  const file = form.get('file');
  if (!isBrandKind(kind)) return jsonError(400, 'invalid_kind');
  if (!(file instanceof Blob)) return jsonError(400, 'file_required');
  if (!BRAND_ALLOWED_MIME.has(file.type)) return jsonError(400, 'unsupported_mime');
  if (file.size === 0) return jsonError(400, 'empty_file');
  if (file.size > MAX_BRAND_BYTES) return jsonError(413, 'file_too_large');

  const bytes = await file.arrayBuffer();
  const sniffed = sniffImageMime(bytes);
  if (!sniffed || !BRAND_ALLOWED_MIME.has(sniffed)) return jsonError(400, 'unsupported_mime');

  const key = kind === 'hero' ? heroKey(clientId, crypto.randomUUID()) : brandKey(clientId, kind);
  await brandStore().set(key, bytes);
  await logAudit(db(), {
    session: auth, op: 'client.brand_image_uploaded', clientId,
    targetType: 'client', targetId: clientId, detail: { kind, key },
  });
  return jsonOk({ key }, { status: 201 });
};

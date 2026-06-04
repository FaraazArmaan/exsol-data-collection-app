// POST /api/files-upload-url
//
// Step 1 of the 2-step upload flow.
// Reserves a blob key + returns a single-use upload_token. Browser PUTs bytes
// to /api/files-upload (Task 11) with the token; then POSTs to /api/files
// (Task 11) to commit metadata.
//
// Token = 32-byte URL-safe random encoded base64url, stored in-memory keyed by
// blob_key. For multi-instance deploys, swap to a Neon-backed table in a
// follow-up; in Phase A single-instance dev + Netlify's same-region edge,
// in-memory is adequate. Token TTL: 5 minutes.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission, resolveClientIdOrRespond,
} from './_shared/permissions';
import { isAllowedMime } from './_shared/files-mime';
import { blobKeyFor } from './_shared/files-storage';
import { signUploadToken } from './_shared/upload-token';

const Body = z.object({
  filename:  z.string().min(1).max(500),
  mime:      z.string().min(1).max(200),
  byte_size: z.number().int().nonnegative().max(5 * 1024 * 1024 * 1024), // 5 GB hard cap
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, '_platform.files.create');
  if (auth instanceof Response) return auth;
  const session = auth;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  if (!isAllowedMime(parsed.data.mime)) return jsonError(400, 'mime_not_allowed');

  // Admin → admin vault. Workspace → workspace scope.
  let blob_key: string;
  if (session.kind === 'admin') {
    blob_key = blobKeyFor({ scope: 'admin' });
  } else {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    blob_key = blobKeyFor({ scope: 'workspace', clientId: scope.clientId });
  }

  const upload_token = await signUploadToken(blob_key);
  return jsonOk({
    blob_key,
    upload_token,
    upload_url: `/api/files-upload?token=${upload_token}`,
    expires_in_seconds: 300,
  });
};

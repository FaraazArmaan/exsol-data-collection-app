// PUT /api/files-upload?token=<upload_token>
//
// Streams the request body into Netlify Blobs at the key reserved in Task 10.
// The single-use token is consumed; subsequent PUTs with the same token 404.

import type { Context } from '@netlify/functions';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission } from './_shared/permissions';
import { consumeToken } from './files-upload-url';
import { filesStore } from './_shared/files-storage';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'PUT') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, '_platform.files.create');
  if (auth instanceof Response) return auth;

  const tok = new URL(req.url).searchParams.get('token');
  if (!tok) return jsonError(400, 'token_required');
  const reserved = consumeToken(tok);
  if (!reserved) return jsonError(404, 'token_invalid_or_expired');

  const body = await req.arrayBuffer();
  if (body.byteLength === 0) return jsonError(400, 'empty_body');

  const store = filesStore();
  await store.set(reserved.blobKey, body);

  return jsonOk({ ok: true, blob_key: reserved.blobKey, byte_size: body.byteLength });
};

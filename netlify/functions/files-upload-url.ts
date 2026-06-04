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
import { randomBytes } from 'node:crypto';
import { jsonError, jsonOk } from './_shared/http';
import {
  authenticateForPermission, resolveClientIdOrRespond,
} from './_shared/permissions';
import { isAllowedMime } from './_shared/files-mime';
import { blobKeyFor } from './_shared/files-storage';

const Body = z.object({
  filename:  z.string().min(1).max(500),
  mime:      z.string().min(1).max(200),
  byte_size: z.number().int().nonnegative().max(5 * 1024 * 1024 * 1024), // 5 GB hard cap
});

// In-memory token table; tokens TTL after 5 minutes.
const tokens = new Map<string, { blobKey: string; expiresAt: number }>();

function newToken(blobKey: string): string {
  const tok = randomBytes(32).toString('base64url');
  tokens.set(tok, { blobKey, expiresAt: Date.now() + 5 * 60_000 });
  return tok;
}

export function consumeToken(tok: string): { blobKey: string } | null {
  const entry = tokens.get(tok);
  if (!entry) return null;
  tokens.delete(tok);
  if (entry.expiresAt < Date.now()) return null;
  return { blobKey: entry.blobKey };
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, '_platform.files.create');
  if (auth instanceof Response) return auth;
  const session = auth;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  if (!isAllowedMime(parsed.data.mime)) {
    return new Response(JSON.stringify({ error: 'mime_not_allowed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // Admin → admin vault. Workspace → workspace scope.
  let blob_key: string;
  if (session.kind === 'admin') {
    blob_key = blobKeyFor({ scope: 'admin' });
  } else {
    const scope = resolveClientIdOrRespond(session, req);
    if (scope instanceof Response) return scope;
    blob_key = blobKeyFor({ scope: 'workspace', clientId: scope.clientId });
  }

  const upload_token = newToken(blob_key);
  return jsonOk({
    blob_key,
    upload_token,
    upload_url: `/api/files-upload?token=${upload_token}`,
    expires_in_seconds: 300,
  });
};

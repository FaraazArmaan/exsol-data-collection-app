import type { Context } from '@netlify/functions';
import { streamImage } from '../../src/lib/image-pipeline.ts';
import { json } from '../../src/lib/http.ts';

export const config = { path: '/api/img/:pid/:fid' };

/**
 * GET /api/img/:pid/:fid
 *
 * Upstream for the Netlify Image CDN. Streams the bytes of a single
 * product image from Netlify Blobs.
 *
 * UNAUTHENTICATED BY DESIGN — the Image CDN fetches this endpoint
 * server-side and cannot forward user cookies. Security comes from the
 * unguessability of the Blobs key (3× UUIDs concatenated, 108+ chars of
 * entropy) plus the product-id binding check inside `streamImage`: a 200
 * response only happens when the (pid, key) pair is bound on a real
 * product.
 *
 * Cache headers are aggressive (immutable, 1 year) because the key
 * encodes a UUID — deleting an image issues a new key, so a stale cache
 * entry can never serve "wrong" content for a given key.
 */
export default async (_req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(context);
  } catch (err) {
    console.error('[img] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(context: Context): Promise<Response> {
  const pid = context.params?.pid;
  const fid = context.params?.fid;
  if (!pid || !fid) return json({ error: 'missing_param' }, 400);

  const result = await streamImage(pid, fid);
  if (!result) return json({ error: 'not_found' }, 404);

  return new Response(result.stream, {
    status: 200,
    headers: {
      'content-type': result.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

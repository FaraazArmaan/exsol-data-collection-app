import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { uploadAndRegister, proxyUrl, type ImageSlot } from '../../src/lib/image-pipeline.ts';
import { json, methodNotAllowed } from '../../src/lib/http.ts';

export const config = {
  path: '/api/workspaces/:wsid/products/:pid/images/upload',
};

/**
 * POST /api/workspaces/:wsid/products/:pid/images/upload
 *
 * Multipart upload: the browser POSTs a FormData with two fields:
 *   - `file` (the image file)
 *   - `slot` ('primary' | 'extra')
 *
 * Function-side flow: parse the multipart body, hand the bytes to
 * imagePipeline.uploadAndRegister (which validates, pushes to Drive, and
 * attaches the file ID to the product row), then return the same shape
 * as the legacy /images/complete endpoint.
 *
 * Cap: Netlify Functions have a 6 MB body limit. We reject anything that
 * arrives (the multipart envelope adds ~200 bytes of overhead, so the
 * effective file cap is ~5.9 MB). Client-side we cap at 5 MB to leave
 * headroom for the envelope + any client-supplied form fields.
 *
 * Permission: `file:upload` (Primary, Manager, Storekeeper).
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[image-upload] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed();

  const workspaceId = context.params?.wsid;
  const productId = context.params?.pid;
  if (!workspaceId || !productId) return json({ error: 'missing_param' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (!can(actor, 'file:upload', { type: 'file', workspaceId })) {
    return json({ error: 'forbidden' }, 403);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return json({ error: 'invalid_multipart', detail: (err as Error).message }, 400);
  }

  const file = formData.get('file');
  const slotRaw = formData.get('slot');
  if (!(file instanceof File)) return json({ error: 'missing_file' }, 400);
  const slot: ImageSlot | null =
    slotRaw === 'primary' || slotRaw === 'extra' ? (slotRaw as ImageSlot) : null;
  if (!slot) return json({ error: 'invalid_slot' }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadAndRegister(actor, productId, file.name, file.type, bytes, slot);
  if ('error' in result) {
    const status = result.error === 'product_not_found' ? 404 : 400;
    return json(result, status);
  }

  return json({
    ...result,
    thumbUrls: {
      primary: result.primaryImageId
        ? proxyUrl(productId, result.primaryImageId, 'thumb')
        : null,
      extras: result.extraImageIds.map((key) => proxyUrl(productId, key, 'thumb')),
    },
  });
}

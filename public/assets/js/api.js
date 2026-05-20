export async function getJSON(path) {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok && res.status !== 401) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function fetchMe() {
  return getJSON('/api/me');
}

export async function fetchConfig() {
  return getJSON('/api/config');
}

export async function signOut() {
  await postJSON('/api/auth/logout');
}

export function requireAuth(onUser) {
  fetchMe().then(({ user }) => {
    if (!user) {
      window.location.href = '/login.html';
      return;
    }
    onUser(user);
  });
}

/**
 * Returns a Netlify Image CDN URL for a given product image.
 *
 * Mirrors the variant query strings in src/lib/image-pipeline.ts so that
 * server-rendered URLs (in API responses) and client-rendered URLs
 * (here in workspace.html / product-edit.html) collide on the same
 * cache key. If you change variants here, change them there too.
 */
export function imageProxyUrl(productId, imageKey, variant = 'thumb') {
  const VARIANTS = {
    thumb: 'w=200&h=200&fit=cover&q=75',
    card: 'w=600&h=600&fit=cover&q=80',
    full: 'w=1600&q=85',
  };
  const upstream = `/api/img/${encodeURIComponent(productId)}/${encodeURIComponent(imageKey)}`;
  const qs = VARIANTS[variant] || VARIANTS.card;
  return `/.netlify/images?url=${encodeURIComponent(upstream)}&${qs}`;
}

/**
 * Uploads a File to a product image slot via a single multipart POST to
 * the Netlify Function, which then pushes to Netlify Blobs server-side.
 * Cap is 5 MB (Netlify Functions body limit is 6 MB; leaves headroom for
 * the multipart envelope). Throws on validation, network, or server errors.
 */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function uploadProductImage(workspaceId, productId, file, slot) {
  // Guard against template-literal stringification of null/undefined IDs.
  if (!workspaceId || !productId) {
    throw new Error('Save the product before uploading images.');
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error(
      `File ${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB; max is ` +
        `${MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const form = new FormData();
  form.append('file', file);
  form.append('slot', slot);

  const res = await fetch(
    `/api/workspaces/${workspaceId}/products/${productId}/images/upload`,
    {
      method: 'POST',
      credentials: 'include',
      // No Content-Type — browser sets it (with boundary) automatically for FormData.
      body: form,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}

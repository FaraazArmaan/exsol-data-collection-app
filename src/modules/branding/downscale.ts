import type { DownscaleKind } from './types';

// Longest-edge cap per kind (px). Aspect preserved; no upscaling.
export const MAX_EDGE: Record<DownscaleKind, number> = {
  favicon: 64, app_icon: 512, logo: 400, logo_alt: 400, social: 1200, hero: 1600,
};

/**
 * Downscale `file` to the per-kind longest-edge cap and re-encode as WebP.
 * On any decode/encode failure (or in a non-browser env), returns the original
 * file unchanged — the server-side 5 MB cap + magic-byte sniff remain the
 * authoritative guard.
 */
export async function downscaleImage(file: File, kind: DownscaleKind): Promise<File> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
    const bitmap = await createImageBitmap(file);
    const cap = MAX_EDGE[kind];
    const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

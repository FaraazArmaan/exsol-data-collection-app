// A/B assignment + open-tracking pixel helpers. Pure and deterministic so the
// send path is reproducible and unit-testable.

export type Variant = 'A' | 'B';

// Stable 32-bit FNV-1a hash of a key (recipient email). Deterministic assignment
// means the same person always lands in the same variant and tests are stable —
// unlike Math.random(), which would re-bucket on every run.
function hash32(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Assign a recipient to variant A or B. `splitPercentToA` is the share (0–100)
 * that goes to A; the remainder goes to B. 100 ⇒ everyone A, 0 ⇒ everyone B.
 */
export function assignVariant(key: string, splitPercentToA: number): Variant {
  const pct = Math.max(0, Math.min(100, Math.round(splitPercentToA)));
  if (pct >= 100) return 'A';
  if (pct <= 0) return 'B';
  return hash32(key) % 100 < pct ? 'A' : 'B';
}

/** 1x1 transparent tracking pixel pointing at the public open endpoint. */
export function openPixelTag(sendId: string, baseUrl: string): string {
  const base = (baseUrl ?? '').replace(/\/$/, '');
  const src = `${base}/api/marketing/track/open?s=${encodeURIComponent(sendId)}`;
  return `<img src="${src}" width="1" height="1" alt="" style="display:none" />`;
}

/** Append the open pixel to an email body (email channel only — sms/whatsapp can't embed it). */
export function withOpenPixel(html: string, sendId: string, baseUrl: string): string {
  return `${html}${openPixelTag(sendId, baseUrl)}`;
}

// 1x1 transparent GIF (43 bytes) returned by the open endpoint.
export const TRACKING_GIF_BASE64 = 'R0lGODlhAQABAID/AMDAwAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

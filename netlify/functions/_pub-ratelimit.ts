// Two-layer IP rate limiter for the public storefront endpoints, backed by
// Netlify Blobs (Functions don't share memory — see the Netlify-no-shared-memory
// note). Counters bucket by wall-clock window; stale keys expire via metadata.
//
// Cheapest anti-abuse with no third-party signup (Turnstile is parked for v2.5).
// See docs/superpowers/specs/2026-06-29-pos-v2-storefront-design.md §7.1.

import { getStore } from '@netlify/blobs';

/** Best-effort client IP from Netlify / proxy headers. */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

async function increment(key: string, ttlSeconds: number): Promise<number> {
  const blobs = getStore('pub-ratelimit');
  const current = Number((await blobs.get(key)) ?? 0);
  const next = current + 1;
  await blobs.setJSON(key, next, { metadata: { expires: Date.now() + ttlSeconds * 1000 } });
  return next;
}

export async function checkLimit(
  ip: string,
  endpointKey: string,
  opts: { perMinute: number; perSlugIp?: { slug: string; per10min: number } },
): Promise<{ ok: true } | { ok: false; code: string }> {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const n1 = await increment(`rl:ip:${ip}:${endpointKey}:${minuteBucket}`, 120);
  if (n1 > opts.perMinute) return { ok: false, code: 'rate_limit_ip' };

  if (opts.perSlugIp) {
    const tenMinuteBucket = Math.floor(Date.now() / 600_000);
    const n2 = await increment(`rl:slug:${opts.perSlugIp.slug}:${ip}:${tenMinuteBucket}`, 1200);
    if (n2 > opts.perSlugIp.per10min) return { ok: false, code: 'rate_limit_slug' };
  }
  return { ok: true };
}

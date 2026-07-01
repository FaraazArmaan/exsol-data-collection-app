import { getStore } from '@netlify/blobs';

// Best-effort fixed-window IP limiter for the anonymous booking-create endpoint.
// Backed by Netlify Blobs. FAILS OPEN on any error — including the non-Netlify
// test/CI env where Blobs isn't configured (getStore throws synchronously). This
// is spam-prevention, not a security boundary, so the accepted-slop read-then-write
// race and fail-open behaviour are fine (mirrors the login limiter's stance).
const WINDOW_SEC = 300;      // 5-minute window
const MAX_PER_WINDOW = 12;   // generous enough for a real user retrying; blocks bot floods

export async function allowBookingCreate(ip: string | null): Promise<boolean> {
  if (!ip) return true;
  try {
    const store = getStore({ name: 'booking-ratelimit', consistency: 'strong' });
    const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SEC);
    const key = `bc:${ip}:${windowStart}`;
    const current = Number((await store.get(key)) ?? 0);
    if (current >= MAX_PER_WINDOW) return false;
    await store.set(key, String(current + 1));
    return true;
  } catch {
    return true; // Blobs unavailable (e.g. tests) → don't block
  }
}

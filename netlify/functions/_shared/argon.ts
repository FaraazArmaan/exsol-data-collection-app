import { hash, verify } from '@node-rs/argon2';

// Lazily computed dummy hash used by verifyPassword to maintain
// constant-time semantics on paths where no real hash exists
// (admin not found, Google-only admin trying password login).
// Without this, an attacker can distinguish "email exists with
// password" from "doesn't" by the ~100 ms latency of a real verify
// vs the ~0 ms of an early return.
//
// Generated on first call rather than hardcoded so it always matches
// the system's current argon2 parameters — if memory/iterations are
// ever tuned, the dummy auto-tracks.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hash('__verifyPassword_constant_time_dummy__');
  }
  return dummyHashPromise;
}

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(plain: string, hashed: string | null): Promise<boolean> {
  const target = hashed ?? (await getDummyHash());
  try {
    const ok = await verify(target, plain);
    // Even if dummy verify spuriously matched (caller passed the dummy plaintext),
    // a null hashed input means "no credential to verify against" — always false.
    return ok && hashed !== null;
  } catch {
    return false;
  }
}

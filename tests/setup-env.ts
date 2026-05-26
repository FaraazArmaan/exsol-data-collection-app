/**
 * Vitest setup file: loads .env into process.env before any test module
 * is imported. This is needed because vitest does not auto-load .env
 * and dotenv is not a direct dependency of this project.
 *
 * The integration tests depend on DATABASE_URL (and JWT_SIGNING_SECRET,
 * GOOGLE_OAUTH_CLIENT_ID, COOKIE_SECURE) being set before handler modules
 * are first imported, because netlify/functions/_shared/env.ts and db.ts
 * cache their parsed values on first call.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
try {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    // Do not overwrite vars already set in the environment (e.g. CI secrets).
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
} catch {
  // .env not present — tests that need real DB will fail naturally.
}

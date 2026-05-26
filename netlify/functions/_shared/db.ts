import { neon } from '@neondatabase/serverless';
import { env } from './env';

let cached: ReturnType<typeof neon> | null = null;
export function db() {
  if (!cached) cached = neon(env().DATABASE_URL);
  return cached;
}
